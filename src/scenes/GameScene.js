import Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT,
  BACK_WALL_BOTTOM_Y, COURT_FLOOR_Y,
  COLORS, DIFFICULTY, MULTIPLIERS,
} from '../config/gameConfig.js';
import * as api from '../api/roundApi.js';

// ─── 常數 ─────────────────────────────────────────────────
const WALL_THICK  = 16;
const RIM_THICK   = 8;
const BALL_RADIUS = 22;
const BALL_R_FAR  = 15;   // 遠端（靠近籃框）視覺半徑
const BALL_R_NEAR = 28;   // 近端（靠近玩家）視覺半徑

// 圖片畫布 780×1688 對應遊戲 390×844，縮放 0.5×
const IMG_CX = GAME_WIDTH  / 2;  // 195
const IMG_CY = GAME_HEIGHT / 2;  // 422

// 從像素分析得到的元件位置（遊戲座標）
const ART = {
  scoreboard: { cx: 195, cy: 182 },   // 計分板中心
  rim:        { cx: 196, cy: 341 },   // 籃框中心
  net:        { cx: 197, cy: 365 },   // 籃網中心（中間透明）
};

export default class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  // ─── Preload ──────────────────────────────────────────────
  preload() {
    this.load.image('bg-court',      'bg-court.png');
    this.load.image('panel-overlay', 'panel-overlay.png');
    this.load.image('backboard',     'backboard.png');
    this.load.image('scoreboard',    'scoreboard.png');
    this.load.image('rim',           'rim.png');
    this.load.image('net',           'net.png');
    this.load.image('ball',          'ball.png');
    this.load.image('ui-bottombar',  'ui-bottombar.png');
  }

  // ─── Init ─────────────────────────────────────────────────
  init() {
    this.currentDifficulty = 'easy';
    this.ballsScored    = 0;
    this.balance        = 1000;
    this.betPresets     = [10, 50, 100, 200, 500, 1000];
    this.betIndex       = 2;
    this.betAmount      = this.betPresets[this.betIndex];
    this.betDeducted    = false;
    this.gameState      = 'idle';
    this.ballPassedRimTop = false;
    this.rimOffsetX     = 0;
    this.rimSeedOffsetX = 0;
    this.roundId        = null;
    this._creating      = false;
  }

  // ─── Create ───────────────────────────────────────────────
  create() {
    this.cameras.main.setBackgroundColor(COLORS.background);
    this.buildCourt();
    this.buildRim();
    this.buildBall();
    this.buildUI();
    this.setupInput();
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

    // 物理：天花板（防止球飛出頂部）
    this.matter.add.rectangle(GAME_WIDTH / 2, -10, GAME_WIDTH, 20, {
      isStatic: true, label: 'ceiling', friction: 0, restitution: 0.55,
    });
    // 物理：地板
    this.floorBody = this.matter.add.rectangle(GAME_WIDTH / 2, COURT_FLOOR_Y, GAME_WIDTH, 20, {
      isStatic: true, label: 'floor', friction: 0.4, restitution: 0.45,
    });

    // 物理：上段垂直牆（後牆區域）
    this.upperLeftWall  = this._makeVerticalWall('left',  diff.machineWidth);
    this.upperRightWall = this._makeVerticalWall('right', diff.machineWidth);

    // 物理：下段斜牆（走廊收斂區域）
    this.lowerLeftWall  = null;
    this.lowerRightWall = null;
    this._rebuildAngledWalls(diff.machineWidth);
  }

  _makeVerticalWall(side, machineW) {
    const sideW = (GAME_WIDTH - machineW) / 2;
    const x     = side === 'left'
      ? sideW - WALL_THICK / 2
      : GAME_WIDTH - sideW + WALL_THICK / 2;
    const halfH = BACK_WALL_BOTTOM_Y / 2;
    return this.matter.add.rectangle(x, halfH, WALL_THICK, BACK_WALL_BOTTOM_Y, {
      isStatic: true, label: 'wall', friction: 0, restitution: 0.72,
    });
  }

  _rebuildAngledWalls(machineW) {
    if (this.lowerLeftWall)  this.matter.world.remove(this.lowerLeftWall);
    if (this.lowerRightWall) this.matter.world.remove(this.lowerRightWall);

    const sideW  = (GAME_WIDTH - machineW) / 2;
    const bwLeft  = sideW;
    const bwRight = GAME_WIDTH - sideW;

    this.lowerLeftWall  = this._makeAngledWall(0,          COURT_FLOOR_Y, bwLeft,  BACK_WALL_BOTTOM_Y);
    this.lowerRightWall = this._makeAngledWall(GAME_WIDTH, COURT_FLOOR_Y, bwRight, BACK_WALL_BOTTOM_Y);
  }

  _makeAngledWall(x1, y1, x2, y2) {
    const dx  = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    return this.matter.add.rectangle(
      (x1 + x2) / 2, (y1 + y2) / 2, len, WALL_THICK,
      { isStatic: true, label: 'wall', friction: 0, restitution: 0.72, angle: Math.atan2(dy, dx) }
    );
  }

  // ─── Rim + Backboard（圖片） ──────────────────────────────
  buildRim() {
    const diff = DIFFICULTY[this.currentDifficulty];
    const cx = diff.rimX;   // 195
    const cy = diff.rimY;   // 341（校準至圖片）
    const rw = diff.rimWidth;

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
      fontFamily: 'DM Mono, monospace',
      fontSize:   '22px',
      fontStyle:  'bold',
      color:      '#e03030',
      shadow:     { offsetX: 0, offsetY: 0, color: '#ff0000', blur: 14, fill: true },
    }).setOrigin(0.5).setDepth(10);

    // 物理：籃框左右碰撞體
    this.leftRimBody = this.matter.add.rectangle(
      cx - rw / 2, cy, RIM_THICK, RIM_THICK,
      { isStatic: true, label: 'rim', friction: 0.2, restitution: 0.55 }
    );
    this.rightRimBody = this.matter.add.rectangle(
      cx + rw / 2, cy, RIM_THICK, RIM_THICK,
      { isStatic: true, label: 'rim', friction: 0.2, restitution: 0.55 }
    );
    // 物理：進球感應器
    this.goalSensor = this.matter.add.rectangle(
      cx, cy + 15, rw - 16, 10,
      { isStatic: true, isSensor: true, label: 'goal' }
    );

    this.rimCenterX = cx;
    this.rimCenterY = cy;
    this.rimWidth   = rw;
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
    this.balanceText = this.add.text(22, 800, `$${this.balance.toLocaleString()}`, {
      fontFamily: 'DM Mono, monospace', fontSize: '15px',
      fontStyle: 'bold', color: '#c9a84c',
    }).setDepth(21);

    // 動態數值：難度（MODE 標題正下方）
    this.diffBtn = this.add.text(w / 2, 800, '簡單', {
      fontFamily: 'DM Mono, monospace', fontSize: '15px',
      fontStyle: 'bold', color: '#c9a84c',
    }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }).setDepth(21);
    this.diffBtn.on('pointerup', () => this.cycleDifficulty());

    // 動態數值：投注（YOUR BET 標題正下方）
    this.betText = this.add.text(w - 22, 800, `$${this.betAmount}`, {
      fontFamily: 'DM Mono, monospace', fontSize: '15px',
      fontStyle: 'bold', color: '#c9a84c',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true }).setDepth(21);
    this.betText.on('pointerup', () => this.cycleBet());

    // 倍率顯示（底部中間，投注欄上方）
    this.multText = this.add.text(w / 2, 726, '1.0x', {
      fontFamily: 'DM Mono, monospace', fontSize: '18px', color: '#c9a84c',
    }).setOrigin(0.5, 1).setDepth(21);

    // 進球點數（底部右側上方）
    this.dotsContainer = this.add.container(w - 16, 720).setDepth(21);
    this.updateDots();

    // 兌現按鈕（底部中央，倍率上方）
    this.cashoutBtn = this.add.text(w / 2, 716, '', {
      fontFamily: 'DM Mono, monospace', fontSize: '16px', color: '#080b10',
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
    const idx   = Math.min(this.ballsScored, mults.length - 1);
    const mult  = mults[idx];

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
    this.betIndex  = idx;
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
    const next  = order[(order.indexOf(this.currentDifficulty) + 1) % 3];
    this.switchDifficulty(next);
  }

  switchDifficulty(key) {
    this.currentDifficulty = key;
    const diff   = DIFFICULTY[key];
    const labels = { easy: '簡單', normal: '普通', hard: '困難' };
    this.diffBtn.setText(labels[key]);

    this.gameState = 'transitioning';
    this.resetBall();

    // 更新物理牆壁
    this.machineWidth = diff.machineWidth;
    this._updateUpperWalls(diff.machineWidth);
    this._rebuildAngledWalls(diff.machineWidth);

    // 更新籃框物理體
    this.rimWidth   = diff.rimWidth;
    this.rimCenterX = diff.rimX;
    this.rimCenterY = diff.rimY;
    this._updateRimPhysics(diff);

    this.rimOffsetX     = 0;
    this.rimSeedOffsetX = 0;
    this.rimImg.x       = IMG_CX;
    this.netImg.x       = IMG_CX;
    this.ledText.x      = ART.scoreboard.cx;

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
    const sideW  = (GAME_WIDTH - machineW) / 2;
    const bwLeft  = sideW;
    const bwRight = GAME_WIDTH - sideW;
    this.matter.body.setPosition(this.upperLeftWall,  { x: bwLeft  - WALL_THICK / 2, y: BACK_WALL_BOTTOM_Y / 2 });
    this.matter.body.setPosition(this.upperRightWall, { x: bwRight + WALL_THICK / 2, y: BACK_WALL_BOTTOM_Y / 2 });
  }

  _updateRimPhysics(diff) {
    this.matter.body.setPosition(this.leftRimBody,  { x: diff.rimX - diff.rimWidth / 2, y: diff.rimY });
    this.matter.body.setPosition(this.rightRimBody, { x: diff.rimX + diff.rimWidth / 2, y: diff.rimY });
    this.matter.body.setPosition(this.goalSensor,   { x: diff.rimX, y: diff.rimY + 15 });
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
    const rw = this.rimWidth;

    // 視覺：整張圖片水平偏移（透明區域不顯示，只有籃框/籃網可見）
    this.rimImg.x = IMG_CX + totalOx;
    this.netImg.x = IMG_CX + totalOx;
    this.ledText.x = ART.scoreboard.cx + totalOx;

    // 物理碰撞體
    this.matter.body.setPosition(this.leftRimBody,  { x: cx - rw / 2 + totalOx, y: cy });
    this.matter.body.setPosition(this.rightRimBody, { x: cx + rw / 2 + totalOx, y: cy });
    this.matter.body.setPosition(this.goalSensor,   { x: cx + totalOx, y: cy + 15 });
  }

  // ─── Input ────────────────────────────────────────────────
  setupInput() {
    this.dragStart  = null;
    this.isDragging = false;
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup',   this.onPointerUp,   this);
  }

  onPointerDown(pointer) {
    if (this.gameState !== 'idle') return;
    const { x: bx, y: by } = this.ballBody.position;
    if (Phaser.Math.Distance.Between(pointer.x, pointer.y, bx, by) < BALL_RADIUS * 2.8) {
      this.isDragging = true;
      this.dragStart  = { x: pointer.x, y: pointer.y, time: pointer.time };
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
    if (this.leftRimBody)  this.leftRimBody.restitution  = params.rimElasticity;
    if (this.rightRimBody) this.rightRimBody.restitution = params.rimElasticity;
    if (this.upperLeftWall)  this.upperLeftWall.restitution  = params.leftWall;
    if (this.lowerLeftWall)  this.lowerLeftWall.restitution  = params.leftWall;
    if (this.upperRightWall) this.upperRightWall.restitution = params.rightWall;
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
      const rimLeft  = this.rimCenterX - this.rimWidth / 2 + totalOx + 10;
      const rimRight = this.rimCenterX + this.rimWidth / 2 + totalOx - 10;
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

    const mults  = MULTIPLIERS[this.currentDifficulty];
    let payout   = Math.floor(this.betAmount * mults[Math.min(this.ballsScored, mults.length - 1)]);

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
    this.roundId        = null;
    this.rimSeedOffsetX = 0;
    this.ballsScored    = 0;
    this.betDeducted    = false;
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
