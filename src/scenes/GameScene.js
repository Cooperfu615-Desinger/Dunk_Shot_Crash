import Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT,
  BACK_WALL_BOTTOM_Y, COURT_FLOOR_Y,
  COLORS, DIFFICULTY, MULTIPLIERS,
} from '../config/gameConfig.js';
import * as api from '../api/roundApi.js';

// ─── 常數 ─────────────────────────────────────────────────
const WALL_THICK = 16;
const BALL_RADIUS = 33;
const BALL_R_FAR = 23;   // 遠端（靠近籃框）視覺半徑
const BALL_R_NEAR = 42;   // 近端（靠近玩家）視覺半徑
// 籃框碰撞體（對應美術 art 40×34，遊戲座標各 ÷2）
const RIM_W = 20;
const RIM_H = 15;

// 機台側牆頂部（走廊側牆從這裡開始，不延伸到天花板）
const MACHINE_TOP_Y = 115;

// 地板摩擦係數設定
const FLOOR_REAR = { friction: 0.60, restitution: 0.25 };
const FLOOR_FRONT = { friction: 0.40, restitution: 0.45 };

// 籃板
const BACKBOARD_Y = 235;  // 物理位置（比籃框高約 40px）
const BACKBOARD_THICK = 10;

// Debug 視覺化顏色表
const DBG = {
  ceiling: { c: 0xffff00, a: 0.40 },
  floor: { c: 0xffff00, a: 0.40 },
  wallV: { c: 0x00ffff, a: 0.38 },
  wallA: { c: 0x4488ff, a: 0.38 },
  backboard: { c: 0xff8800, a: 0.45 },
  rim: { c: 0xff4444, a: 0.55 },
  goal: { c: 0x00ff88, a: 0.45 },
  ball: { c: 0xffffff, a: 0.30 },
};

// 圖片畫布 780×1400 對應遊戲 390×700，縮放 0.5×
const IMG_CX = GAME_WIDTH / 2;   // 195
const IMG_CY = GAME_HEIGHT / 2;  // 350

// 從像素分析得到的元件位置（遊戲座標，依新圖比例校準）
const ART = {
  scoreboard: { cx: 195, cy: 150 },   // 計分板中心
  rim: { cx: 196, cy: 275 },          // 籃框中心
  net: { cx: 197, cy: 300 },          // 籃網中心
};

export default class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  // ─── Preload ──────────────────────────────────────────────
  preload() {
    this.load.image('bg-court', 'bg-court.png');
    this.load.image('panel-overlay', 'panel-overlay.png');
    this.load.image('backboard', 'backboard.png');
    this.load.image('scoreboard', 'scoreboard.png');
    this.load.image('rim', 'rim.png');
    this.load.image('net', 'net.png');
    this.load.image('ball', 'ball.png');
    this.load.image('ui-bottombar', 'ui-bottombar.png');
  }

  // ─── Init ─────────────────────────────────────────────────
  init() {
    this.currentDifficulty = 'easy';
    this.ballsScored = 0;
    this.balance = 1000;
    this.betPresets = [10, 50, 100, 200, 500, 1000];
    this.betIndex = 2;
    this.betAmount = this.betPresets[this.betIndex];
    this.betDeducted = false;
    this.gameState = 'idle';
    this.ballPassedRimTop = false;
    this.rimOffsetX = 0;
    this.rimSeedOffsetX = 0;
    this.roundId = null;
    this._creating = false;
    this.debugMode = false;
  }

  // ─── Create ───────────────────────────────────────────────
  create() {
    this.cameras.main.setBackgroundColor(COLORS.background);
    this.buildCourt();
    this.buildRim();
    this.buildBall();
    this.buildUI();
    this.setupInput();
    // Debug 圖層（最高層，切換顯示/隱藏）
    this.debugGfx = this.add.graphics().setDepth(99).setVisible(false);
    this._buildDebugButton();
    // 撐滿螢幕（無黑邊），保持所有遊戲座標不變
    this._fitCamera();
    this.scale.on('resize', this._fitCamera, this);
  }

  // ─── Debug 視覺化 ─────────────────────────────────────────
  _buildDebugButton() {
    const btn = this.add.text(GAME_WIDTH - 10, 10, 'DEBUG', {
      fontFamily: 'DM Mono, monospace',
      fontSize: '11px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 6, y: 4 },
    }).setOrigin(1, 0).setDepth(98).setAlpha(0.70)
      .setInteractive({ useHandCursor: true });

    btn.on('pointerup', () => this._toggleDebug(btn));
    this.debugBtn = btn;
  }

  _toggleDebug(btn) {
    this.debugMode = !this.debugMode;
    this.debugGfx.setVisible(this.debugMode);
    if (!this.debugMode) this.debugGfx.clear();
    btn.setStyle({ backgroundColor: this.debugMode ? '#cc4400' : '#333333' });
  }

  /** 每幀重繪所有物理碰撞範圍（debugMode 開啟時） */
  _drawDebugBodies() {
    const g = this.debugGfx;
    g.clear();

    // 依頂點繪製任意多邊形
    const poly = (body, { c, a }) => {
      if (!body) return;
      const v = body.vertices;
      g.fillStyle(c, a);
      g.beginPath();
      g.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) g.lineTo(v[i].x, v[i].y);
      g.closePath();
      g.fillPath();
      // 邊框
      g.lineStyle(1.5, c, Math.min(a + 0.4, 1));
      g.strokePath();
    };

    // 圓形（球）
    const circ = (body, { c, a }) => {
      if (!body) return;
      g.fillStyle(c, a);
      g.fillCircle(body.position.x, body.position.y, body.circleRadius ?? BALL_RADIUS);
      g.lineStyle(1.5, c, Math.min(a + 0.4, 1));
      g.strokeCircle(body.position.x, body.position.y, body.circleRadius ?? BALL_RADIUS);
    };

    poly(this.ceilingBody, DBG.ceiling);
    poly(this.leftWallCap, DBG.ceiling);
    poly(this.rightWallCap, DBG.ceiling);
    poly(this.floorBody, DBG.floor);
    poly(this.leftWallBlock, DBG.wallV);
    poly(this.rightWallBlock, DBG.wallV);
    poly(this.leftRimBody, DBG.rim);
    poly(this.rightRimBody, DBG.rim);
    poly(this.goalSensor, DBG.goal);
    circ(this.ballBody, DBG.ball);
  }

  // ─── 填滿螢幕 ────────────────────────────────────────────
  /**
   * 用 camera zoom 讓 390×844 的遊戲世界撐滿任何尺寸的螢幕。
   * 取 max(scaleX, scaleY) → ENVELOP 效果：四邊無黑邊，
   * 當長寬比不完全一致時極小量裁切（正常手機幾乎感覺不到）。
   */
  _fitCamera() {
    const { width, height } = this.scale;
    const scaleX = width / GAME_WIDTH;
    const scaleY = height / GAME_HEIGHT;
    // FIT：完整顯示遊戲世界，多餘空間由背景色填滿（與 body 同色，無黑邊感）
    const zoom = Math.min(scaleX, scaleY);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
  }

  // ─── 共用：全畫布圖片貼法 ─────────────────────────────────
  /** 將 780×1688 的圖縮放至遊戲畫布大小，置中放置 */
  _imgFull(key, depth) {
    return this.add.image(IMG_CX, IMG_CY, key)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setDepth(depth);
  }

  // ─── Court ───────────────────────────────────────────────
  buildCourt() {
    const diff = DIFFICULTY[this.currentDifficulty];
    this.machineWidth = diff.machineWidth;

    // 層次 0：球場背景
    this._imgFull('bg-court', 0);
    // 層次 1：籃球機本體（中間透明，球在裡面玩）
    this._imgFull('panel-overlay', 1);

    // 物理：天花板（y=65，限制球不飛太高）
    this.ceilingBody = this.matter.add.rectangle(GAME_WIDTH / 2, 65, GAME_WIDTH, 20, {
      isStatic: true, label: 'ceiling', friction: 0, restitution: 0.55,
    });
    // 物理：地板（單一薄板，球落地後觸發失敗）
    this.floorBody = this.matter.add.rectangle(
      GAME_WIDTH / 2, COURT_FLOOR_Y, GAME_WIDTH, 20,
      { isStatic: true, label: 'floor', ...FLOOR_FRONT }
    );

    // 物理：上段側牆（實心矩形，完整填滿走廊外側區域）
    this.leftWallBlock = null;
    this.rightWallBlock = null;
    this._rebuildSideWallBlocks(diff.machineWidth);

    // 下段斜牆已移除
  }

  /** 重建上段側牆薄牆（16px 細條，只有內側面會碰撞，無頂底面問題） */
  _rebuildSideWallBlocks(machineW) {
    if (this.leftWallBlock) this.matter.world.remove(this.leftWallBlock);
    if (this.rightWallBlock) this.matter.world.remove(this.rightWallBlock);
    if (this.leftWallCap) this.matter.world.remove(this.leftWallCap);
    if (this.rightWallCap) this.matter.world.remove(this.rightWallCap);

    const sideW = (GAME_WIDTH - machineW) / 2;
    const halfH = BACK_WALL_BOTTOM_Y / 2;

    // 左側薄牆：貼在走廊左內緣
    this.leftWallBlock = this.matter.add.rectangle(
      sideW - WALL_THICK / 2, halfH, WALL_THICK, BACK_WALL_BOTTOM_Y,
      { isStatic: true, label: 'wall', friction: 0.05, restitution: 0.72 }
    );
    // 右側薄牆：貼在走廊右內緣
    this.rightWallBlock = this.matter.add.rectangle(
      GAME_WIDTH - sideW + WALL_THICK / 2, halfH, WALL_THICK, BACK_WALL_BOTTOM_Y,
      { isStatic: true, label: 'wall', friction: 0.05, restitution: 0.72 }
    );
    // 水平頂蓋（防止球從走廊外側上方飛出）
    this.leftWallCap = this.matter.add.rectangle(
      sideW / 2, MACHINE_TOP_Y, sideW, WALL_THICK,
      { isStatic: true, label: 'ceiling', friction: 0, restitution: 0.55 }
    );
    this.rightWallCap = this.matter.add.rectangle(
      GAME_WIDTH - sideW / 2, MACHINE_TOP_Y, sideW, WALL_THICK,
      { isStatic: true, label: 'ceiling', friction: 0, restitution: 0.55 }
    );
  }

  _rebuildAngledWalls(machineW) {
    if (this.lowerLeftWall) this.matter.world.remove(this.lowerLeftWall);
    if (this.lowerRightWall) this.matter.world.remove(this.lowerRightWall);

    const sideW = (GAME_WIDTH - machineW) / 2;
    const bwLeft = sideW;
    const bwRight = GAME_WIDTH - sideW;

    this.lowerLeftWall = this._makeAngledWall(0, COURT_FLOOR_Y, bwLeft, BACK_WALL_BOTTOM_Y);
    this.lowerRightWall = this._makeAngledWall(GAME_WIDTH, COURT_FLOOR_Y, bwRight, BACK_WALL_BOTTOM_Y);
  }

  _makeAngledWall(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    return this.matter.add.rectangle(
      (x1 + x2) / 2, (y1 + y2) / 2, len, WALL_THICK,
      { isStatic: true, label: 'wall', friction: 0.10, restitution: 0.65, angle: Math.atan2(dy, dx) }  // 斜牆略有摩擦
    );
  }

  // ─── Rim + Backboard（圖片） ──────────────────────────────
  buildRim() {
    const diff = DIFFICULTY[this.currentDifficulty];
    const cx = diff.rimX;           // 195
    const cy = diff.rimY;           // 341（校準至圖片）
    const ro = diff.rimBodyOffset;  // 碰撞體距中心距離

    // 層次 2：籃板
    this._imgFull('backboard', 2);
    // 層次 3：計分板
    this._imgFull('scoreboard', 3);
    // 層次 4：籃框（可左右移動，所以存 reference）
    this.rimImg = this._imgFull('rim', 4);
    // 層次 6：籃網（在球上方，形成入網感）
    this.netImg = this._imgFull('net', 6);

    // LED 倍率文字（疊在計分板上）
    this.ledText = this.add.text(ART.scoreboard.cx, ART.scoreboard.cy, '1.0x', {
      fontFamily: 'DSEG7, monospace',
      fontSize: '22px',
      color: '#e03030',
    }).setOrigin(0.5).setDepth(10);

    // 物理：籃框左右碰撞體（寬扁矩形，對應美術籃框兩端橫桿）
    this.leftRimBody = this.matter.add.rectangle(
      cx - ro, cy, RIM_W, RIM_H,
      { isStatic: true, label: 'rim', friction: 0.15, restitution: 0.55 }
    );
    this.rightRimBody = this.matter.add.rectangle(
      cx + ro, cy, RIM_W, RIM_H,
      { isStatic: true, label: 'rim', friction: 0.15, restitution: 0.55 }
    );
    // 物理：進球感應器（對應美術內緣 28px，僅作 debug 顯示用）
    this.goalSensor = this.matter.add.rectangle(
      cx, cy + 10, 40, 14,
      { isStatic: true, isSensor: true, label: 'goal' }
    );
    // 籃板物理體已移除
    this.backboardBody = null;

    this.rimCenterX = cx;
    this.rimCenterY = cy;
    this.rimBodyOffset = ro;
    this.scoringHalf = diff.scoringHalf;
  }

  // ─── Ball（圖片精靈） ─────────────────────────────────────
  buildBall() {
    const startX = GAME_WIDTH / 2;
    const startY = COURT_FLOOR_Y - 80;

    this.ballStartX = startX;
    this.ballStartY = startY;

    // 物理圓形體
    this.ballBody = this.matter.add.circle(startX, startY, BALL_RADIUS, {
      restitution: 0.78, friction: 0.25, frictionAir: 0.008,
      density: 0.003, label: 'ball',
    });
    this.matter.body.setStatic(this.ballBody, true);

    // 層次 5：球圖片（在籃框上、籃網下）
    this.ballSprite = this.add.image(startX, startY, 'ball').setDepth(5);
    const r = this._perspRadius(startY);
    this.ballSprite.setDisplaySize(r * 2, r * 2);

    this.matter.world.on('collisionstart', this.onCollision, this);
  }

  _perspRadius(y) {
    const t = Phaser.Math.Clamp(
      (y - BACK_WALL_BOTTOM_Y) / (COURT_FLOOR_Y - BACK_WALL_BOTTOM_Y), 0, 1
    );
    return Phaser.Math.Linear(BALL_R_FAR, BALL_R_NEAR, t);
  }

  _updateBallSprite(x, y, glowing) {
    const r = this._perspRadius(y);
    this.ballSprite.setPosition(x, y);
    this.ballSprite.setDisplaySize(r * 2, r * 2);
    if (glowing) {
      this.ballSprite.setTint(0xffdd88);
    } else {
      this.ballSprite.clearTint();
    }
  }

  resetBall() {
    this.matter.body.setPosition(this.ballBody, { x: this.ballStartX, y: this.ballStartY });
    this.matter.body.setVelocity(this.ballBody, { x: 0, y: 0 });
    this.matter.body.setAngularVelocity(this.ballBody, 0);
    this.matter.body.setStatic(this.ballBody, true);
    this.ballSprite.setRotation(0);
    this._updateBallSprite(this.ballStartX, this.ballStartY, false);
    this.ballPassedRimTop = false;
    this._preCreateRound();
  }

  // ─── UI ───────────────────────────────────────────────────
  buildUI() {
    const w = GAME_WIDTH;

    // 底部欄圖片（最高層）
    this._imgFull('ui-bottombar', 20);

    // 動態數值：餘額（BALANCE 標題正下方）
    this.balanceText = this.add.text(65, 662, `$${this.balance.toLocaleString()}`, {
      fontFamily: 'DSEG7, monospace', fontSize: '15px',
      color: '#c9a84c',
    }).setOrigin(0.5, 0).setDepth(21);

    // 動態數值：難度（MODE 標題正下方）
    this.diffBtn = this.add.text(w / 2, 662, '簡單', {
      fontFamily: 'DM Mono, monospace', fontSize: '15px',
      fontStyle: 'bold', color: '#c9a84c',
    }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }).setDepth(21);
    this.diffBtn.on('pointerup', () => this.cycleDifficulty());

    // 動態數值：投注（YOUR BET 標題正下方）
    this.betText = this.add.text(325, 662, `$${this.betAmount}`, {
      fontFamily: 'DSEG7, monospace', fontSize: '15px',
      color: '#c9a84c',
    }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }).setDepth(21);
    this.betText.on('pointerup', () => this.cycleBet());

    // 倍率顯示（底部中間，投注欄上方）
    this.multText = this.add.text(w / 2, 600, '1.0x', {
      fontFamily: 'DSEG7, monospace', fontSize: '18px', color: '#c9a84c',
    }).setOrigin(0.5, 1).setDepth(21);

    // 進球點數（底部右側上方）
    this.dotsContainer = this.add.container(w - 16, 596).setDepth(21);
    this.updateDots();

    // 兌現按鈕（底部中央，倍率上方）
    this.cashoutBtn = this.add.text(w / 2, 590, '', {
      fontFamily: 'DSEG7, monospace', fontSize: '16px', color: '#080b10',
      backgroundColor: '#c9a84c', padding: { x: 24, y: 8 },
    }).setOrigin(0.5, 1).setInteractive({ useHandCursor: true })
      .setAlpha(0).setDepth(21);
    this.cashoutBtn.on('pointerup', () => this.cashout());

    // 投球提示
    this.hintText = this.add.text(w / 2, COURT_FLOOR_Y - 50, '長壓球體上滑投球', {
      fontFamily: 'DM Mono, monospace', fontSize: '12px', color: '#c9a84c', alpha: 0.45,
    }).setOrigin(0.5).setDepth(21);
  }

  updateDots() {
    this.dotsContainer.removeAll(true);
    for (let i = 0; i < Math.min(this.ballsScored, 8); i++) {
      this.dotsContainer.add(this.add.circle(-(i * 12), 0, 4, COLORS.gold));
    }
  }

  updateMultiplierDisplay() {
    const mults = MULTIPLIERS[this.currentDifficulty];
    const idx = Math.min(this.ballsScored, mults.length - 1);
    const mult = mults[idx];

    this.multText.setText(`${mult}x`);
    this.ledText.setText(`${mult}x`);

    if (this.ballsScored > 0) {
      const payout = Math.floor(this.betAmount * mult);
      this.cashoutBtn.setText(`兌現 $${payout}  →`);
      this.tweens.add({ targets: this.cashoutBtn, alpha: 1, duration: 200 });
    }
  }

  updateBalanceDisplay() {
    this.balanceText.setText(`$${this.balance.toLocaleString()}`);
  }

  cycleBet() {
    if (this.betDeducted) return;
    let idx = (this.betIndex + 1) % this.betPresets.length;
    let tries = 0;
    while (this.betPresets[idx] > this.balance && tries++ < this.betPresets.length) {
      idx = (idx + 1) % this.betPresets.length;
    }
    if (this.betPresets[idx] > this.balance) return;
    this.betIndex = idx;
    this.betAmount = this.betPresets[idx];
    this.betText.setText(`$${this.betAmount}`);
    this.tweens.add({ targets: this.betText, scaleX: 1.2, scaleY: 1.2, yoyo: true, duration: 80 });
    this.roundId = null;
    this._preCreateRound();
  }

  lockBet() {
    if (this.betDeducted) return;
    this.betDeducted = true;
    this.balance -= this.betAmount;
    this.updateBalanceDisplay();
  }

  // ─── 難度切換 ─────────────────────────────────────────────
  cycleDifficulty() {
    if (this.gameState !== 'idle' || this.betDeducted) return;
    this.roundId = null;
    const order = ['easy', 'normal', 'hard'];
    const next = order[(order.indexOf(this.currentDifficulty) + 1) % 3];
    this.switchDifficulty(next);
  }

  switchDifficulty(key) {
    this.currentDifficulty = key;
    const diff = DIFFICULTY[key];
    const labels = { easy: '簡單', normal: '普通', hard: '困難' };
    this.diffBtn.setText(labels[key]);

    this.gameState = 'transitioning';
    this.resetBall();

    // 更新物理牆壁
    this.machineWidth = diff.machineWidth;
    this._updateUpperWalls(diff.machineWidth);

    // 更新籃框物理體（rimBodyOffset/scoringHalf 在 _updateRimPhysics 內更新）
    this.rimCenterX = diff.rimX;
    this.rimCenterY = diff.rimY;
    this._updateRimPhysics(diff);

    this.rimOffsetX = 0;
    this.rimSeedOffsetX = 0;
    this.rimImg.x = IMG_CX;
    this.netImg.x = IMG_CX;
    this.ledText.x = ART.scoreboard.cx;

    this.ballsScored = 0;
    this.betDeducted = false;
    this.updateDots();
    this.cashoutBtn.setAlpha(0);
    this.multText.setText('1.0x');
    this.ledText.setText('1.0x');

    this.gameState = 'idle';
    this._preCreateRound();
  }

  _updateUpperWalls(machineW) {
    this._rebuildSideWallBlocks(machineW);
  }

  _updateRimPhysics(diff) {
    const ro = diff.rimBodyOffset;
    this.matter.body.setPosition(this.leftRimBody, { x: diff.rimX - ro, y: diff.rimY });
    this.matter.body.setPosition(this.rightRimBody, { x: diff.rimX + ro, y: diff.rimY });
    this.matter.body.setPosition(this.goalSensor, { x: diff.rimX, y: diff.rimY + 10 });
    this.rimBodyOffset = ro;
    this.scoringHalf = diff.scoringHalf;
  }

  _createBackboard(machineW) {
    return this.matter.add.rectangle(
      GAME_WIDTH / 2, BACKBOARD_Y, machineW, BACKBOARD_THICK,
      { isStatic: true, label: 'backboard', friction: 0, restitution: 0.40 }
    );
  }

  // ─── 籃框移動（normal / hard） ────────────────────────────
  _updateRimMovement(time) {
    const diff = DIFFICULTY[this.currentDifficulty];
    if (!diff.rimMove) {
      this.rimOffsetX = 0;
    } else {
      const t = time * 0.001 * (diff.rimMoveSpeed / 100);
      if (this.currentDifficulty === 'normal') {
        this.rimOffsetX = Math.sin(t) * diff.rimMoveRange;
      } else {
        this.rimOffsetX =
          Math.sin(t * 1.0) * diff.rimMoveRange * 0.6 +
          Math.sin(t * 1.9) * diff.rimMoveRange * 0.4;
      }
    }

    const totalOx = this.rimOffsetX + (this.rimSeedOffsetX ?? 0);
    const cx = this.rimCenterX;
    const cy = this.rimCenterY;
    const ro = this.rimBodyOffset;

    // 視覺：整張圖片水平偏移（透明區域不顯示，只有籃框/籃網可見）
    this.rimImg.x = IMG_CX + totalOx;
    this.netImg.x = IMG_CX + totalOx;
    this.ledText.x = ART.scoreboard.cx + totalOx;

    // 物理碰撞體
    this.matter.body.setPosition(this.leftRimBody, { x: cx - ro + totalOx, y: cy });
    this.matter.body.setPosition(this.rightRimBody, { x: cx + ro + totalOx, y: cy });
    this.matter.body.setPosition(this.goalSensor, { x: cx + totalOx, y: cy + 10 });
  }

  // ─── Input ────────────────────────────────────────────────
  setupInput() {
    this.dragStart = null;
    this.isDragging = false;
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
  }

  onPointerDown(pointer) {
    if (this.gameState !== 'idle') return;
    const { x: bx, y: by } = this.ballBody.position;
    if (Phaser.Math.Distance.Between(pointer.x, pointer.y, bx, by) < BALL_RADIUS * 2.8) {
      this.isDragging = true;
      this.dragStart = { x: pointer.x, y: pointer.y, time: pointer.time };
      this._updateBallSprite(bx, by, true);
      this.hintText.setAlpha(0);
    }
  }

  onPointerMove(pointer) {
    if (!this.isDragging) return;
    const { x, y } = this.ballBody.position;
    this._updateBallSprite(x, y, true);
  }

  onPointerUp(pointer) {
    if (!this.isDragging) return;
    this.isDragging = false;
    const dx = pointer.x - this.dragStart.x;
    const dy = pointer.y - this.dragStart.y;
    if (dy > -30) {
      const { x, y } = this.ballBody.position;
      this._updateBallSprite(x, y, false);
      return;
    }
    this.shoot(dx, dy);
  }

  // ─── 射球 ─────────────────────────────────────────────────
  shoot(dx, dy) {
    this.lockBet();
    this.gameState = 'flying';

    // 立即射球
    this.matter.body.setStatic(this.ballBody, false);
    const vx = Phaser.Math.Clamp(dx * 0.30, -25, 25);
    const vy = Phaser.Math.Clamp(dy * 0.30, -55, -8);
    this.matter.body.setVelocity(this.ballBody, { x: vx, y: vy });
    this.ballPassedRimTop = false;

    // 背景取物理參數
    this._fetchBallParams();
  }

  async _fetchBallParams() {
    try {
      if (!this.roundId) {
        const round = await api.createRound(this.currentDifficulty, this.betAmount);
        this.roundId = round.roundId;
        console.log('[API] createRound →', this.roundId);
      }
      const ball = await api.nextBall(this.roundId);
      if (this.gameState === 'flying') {
        this._applyPhysicsParams(ball.params);
        console.log('[API] params nonce', ball.nonce, ball.params);
      }
    } catch (e) {
      console.warn('[API] _fetchBallParams 失敗:', e.message);
    }
  }

  async _preCreateRound() {
    if (this.roundId || this._creating) return;
    this._creating = true;
    try {
      const round = await api.createRound(this.currentDifficulty, this.betAmount);
      this.roundId = round.roundId;
      console.log('[API] pre-created round:', this.roundId);
    } catch (e) {
      console.warn('[API] pre-create 失敗:', e.message);
    }
    this._creating = false;
  }

  _applyPhysicsParams(params) {
    if (this.leftRimBody) this.leftRimBody.restitution = params.rimElasticity;
    if (this.rightRimBody) this.rightRimBody.restitution = params.rimElasticity;
    if (this.leftWallBlock) this.leftWallBlock.restitution = params.leftWall;
    if (this.lowerLeftWall) this.lowerLeftWall.restitution = params.leftWall;
    if (this.rightWallBlock) this.rightWallBlock.restitution = params.rightWall;
    if (this.lowerRightWall) this.lowerRightWall.restitution = params.rightWall;
    this.rimSeedOffsetX = params.rimOffset ?? 0;
  }

  // ─── Collision ────────────────────────────────────────────
  onCollision(event) {
    event.pairs.forEach(({ bodyA, bodyB }) => {
      const labels = [bodyA.label, bodyB.label];
      if (labels.includes('ball') && labels.includes('floor') && this.gameState === 'flying') {
        this.time.delayedCall(900, () => this.triggerFail());
      }
    });
  }

  // ─── Update ───────────────────────────────────────────────
  update(time) {
    if (this.debugMode) this._drawDebugBodies();

    if (this.gameState !== 'transitioning') {
      this._updateRimMovement(time);
    }

    if (this.gameState !== 'flying') return;

    const { x: bx, y: by } = this.ballBody.position;
    this._updateBallSprite(bx, by, false);
    // 球自轉
    this.ballSprite.rotation = this.ballBody.angle;

    // 進球判定
    const totalOx = this.rimOffsetX + (this.rimSeedOffsetX ?? 0);
    if (!this.ballPassedRimTop && by < this.rimCenterY) this.ballPassedRimTop = true;
    if (this.ballPassedRimTop && by > this.rimCenterY + 10 && by < this.rimCenterY + 55) {
      const rimLeft = this.rimCenterX - this.scoringHalf + totalOx;
      const rimRight = this.rimCenterX + this.scoringHalf + totalOx;
      if (bx > rimLeft && bx < rimRight) this.triggerScore();
    }

    if (by > GAME_HEIGHT + 100) this.triggerFail();
  }

  // ─── Game Logic ───────────────────────────────────────────
  triggerScore() {
    if (this.gameState !== 'flying') return;
    this.gameState = 'scored';
    this.ballsScored++;
    this.rimSeedOffsetX = 0;

    // 籃網搖動效果
    this.tweens.add({
      targets: this.netImg,
      x: { from: IMG_CX - 3, to: IMG_CX + 3 },
      yoyo: true, repeat: 4, duration: 55,
    });

    // 後端記錄（背景）
    if (this.roundId) {
      api.recordScore(this.roundId)
        .then(r => console.log('[API] recordScore ×', r.multiplier))
        .catch(e => console.warn('[API] recordScore:', e.message));
    }

    this.updateMultiplierDisplay();
    this.updateDots();

    // LED 彈跳
    this.tweens.add({ targets: this.ledText, scaleX: 1.3, scaleY: 1.3, yoyo: true, duration: 130 });

    this.tweens.add({
      targets: this.multText, scaleX: 1.3, scaleY: 1.3, yoyo: true, duration: 120,
      onComplete: () => {
        this.time.delayedCall(400, () => { this.resetBall(); this.gameState = 'idle'; });
      },
    });
  }

  triggerFail() {
    if (this.gameState === 'failed') return;
    this.gameState = 'failed';
    this.rimSeedOffsetX = 0;

    if (this.roundId) {
      const rid = this.roundId;
      this.roundId = null;
      api.fail(rid)
        .then(r => console.log('[API] fail → serverSeed:', r.serverSeed))
        .catch(e => console.warn('[API] fail:', e.message));
    }

    const overlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.failure, 0.35).setDepth(30);
    this.tweens.add({ targets: overlay, alpha: 0, duration: 600, onComplete: () => overlay.destroy() });

    const failText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `沒進\n-$${this.betAmount}`, {
      fontFamily: 'DM Mono, monospace', fontSize: '28px', color: '#c95a4c', align: 'center',
    }).setOrigin(0.5).setAlpha(0).setDepth(30);

    this.tweens.add({
      targets: failText, alpha: 1, duration: 300, hold: 1200, yoyo: true,
      onComplete: () => { failText.destroy(); this.endRound(); },
    });
  }

  async cashout() {
    if (this.gameState !== 'idle' || this.ballsScored === 0) return;
    this.gameState = 'cashing';

    const mults = MULTIPLIERS[this.currentDifficulty];
    let payout = Math.floor(this.betAmount * mults[Math.min(this.ballsScored, mults.length - 1)]);

    if (this.roundId) {
      try {
        const result = await api.cashout(this.roundId);
        payout = result.payout;
        console.log('[API] cashout payout:', payout, '| seed:', result.serverSeed);
        this.roundId = null;
      } catch (e) {
        console.warn('[API] cashout 失敗:', e.message);
        this.roundId = null;
      }
    }

    this.balance += payout;
    this.updateBalanceDisplay();

    const winText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `+$${payout - this.betAmount}`, {
      fontFamily: 'DM Mono, monospace', fontSize: '52px', color: '#c9a84c',
    }).setOrigin(0.5).setAlpha(0).setDepth(30);

    this.tweens.add({
      targets: winText, alpha: 1, y: GAME_HEIGHT / 2 - 60,
      duration: 500, ease: 'Back.Out', hold: 1000, yoyo: true,
      onComplete: () => { winText.destroy(); this.endRound(); },
    });
  }

  endRound() {
    this.roundId = null;
    this.rimSeedOffsetX = 0;
    this.ballsScored = 0;
    this.betDeducted = false;
    this.updateDots();
    this.multText.setText('1.0x');
    this.ledText.setText('1.0x');
    this.cashoutBtn.setAlpha(0);
    this.hintText.setAlpha(0.45);
    while (this.betAmount > this.balance && this.betIndex > 0) {
      this.betIndex--;
      this.betAmount = this.betPresets[this.betIndex];
    }
    this.betText.setText(`$${this.betAmount}`);
    this.resetBall();
    this.gameState = 'idle';
  }
}
