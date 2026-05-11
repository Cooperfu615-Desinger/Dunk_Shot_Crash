import Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT,
  BACK_WALL_BOTTOM_Y, COURT_FLOOR_Y,
  COLORS, DIFFICULTY, MULTIPLIERS,
} from '../config/gameConfig.js';

const WALL_THICK   = 16;
const RIM_THICK    = 8;
const NET_HEIGHT   = 55;
const BALL_RADIUS  = 22; // physics radius (fixed)

// Y-scale for ball perspective: radius at bottom vs near back wall
const BALL_R_FAR   = 15;
const BALL_R_NEAR  = 28;

export default class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  // ─── Init ────────────────────────────────────────────────
  init() {
    this.currentDifficulty = 'easy';
    this.ballsScored  = 0;
    this.balance      = 1000;
    this.betPresets   = [10, 50, 100, 200, 500, 1000];
    this.betIndex     = 2;
    this.betAmount    = this.betPresets[this.betIndex];
    this.betDeducted  = false;
    this.gameState    = 'idle';
    this.ballPassedRimTop = false;
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.background);
    this.buildCourt();
    this.buildRim();
    this.buildBall();
    this.buildUI();
    this.setupInput();
  }

  // ─── Court ───────────────────────────────────────────────
  buildCourt() {
    const diff = DIFFICULTY[this.currentDifficulty];
    this.machineWidth = diff.machineWidth;

    // Graphics layers (order = draw order)
    this.corridorBg   = this.add.graphics(); // back wall + corridor floor
    this.panelOverlay = this.add.graphics(); // dark machine side panels (drawn OVER ball)

    // Ceiling (invisible, keeps ball from leaving top)
    this.matter.add.rectangle(GAME_WIDTH / 2, -10, GAME_WIDTH, 20, {
      isStatic: true, label: 'ceiling', friction: 0, restitution: 0.55,
    });
    // Floor
    this.floorBody = this.matter.add.rectangle(GAME_WIDTH / 2, COURT_FLOOR_Y, GAME_WIDTH, 20, {
      isStatic: true, label: 'floor', friction: 0.4, restitution: 0.45,
    });

    // Upper vertical walls (back wall width zone, y 0 → BACK_WALL_BOTTOM_Y)
    this.upperLeftWall  = this._makeVerticalWall('left',  diff.machineWidth);
    this.upperRightWall = this._makeVerticalWall('right', diff.machineWidth);

    // Lower angled walls (corridor zone, converge from screen edges to back wall)
    this.lowerLeftWall  = null;
    this.lowerRightWall = null;
    this._rebuildAngledWalls(diff.machineWidth);

    this.drawCorridor(this.machineWidth);
  }

  _makeVerticalWall(side, machineW) {
    const sideW   = (GAME_WIDTH - machineW) / 2;
    const x       = side === 'left'
      ? sideW - WALL_THICK / 2
      : GAME_WIDTH - sideW + WALL_THICK / 2;
    const halfH   = BACK_WALL_BOTTOM_Y / 2;
    return this.matter.add.rectangle(x, halfH, WALL_THICK, BACK_WALL_BOTTOM_Y, {
      isStatic: true, label: 'wall', friction: 0, restitution: 0.72,
    });
  }

  _rebuildAngledWalls(machineW) {
    if (this.lowerLeftWall)  this.matter.world.remove(this.lowerLeftWall);
    if (this.lowerRightWall) this.matter.world.remove(this.lowerRightWall);

    const sideW = (GAME_WIDTH - machineW) / 2;
    const bwLeft  = sideW;
    const bwRight = GAME_WIDTH - sideW;

    this.lowerLeftWall  = this._makeAngledWall(0,          COURT_FLOOR_Y, bwLeft,  BACK_WALL_BOTTOM_Y);
    this.lowerRightWall = this._makeAngledWall(GAME_WIDTH,  COURT_FLOOR_Y, bwRight, BACK_WALL_BOTTOM_Y);
  }

  _makeAngledWall(x1, y1, x2, y2) {
    const dx  = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    return this.matter.add.rectangle(
      (x1 + x2) / 2, (y1 + y2) / 2, len, WALL_THICK,
      { isStatic: true, label: 'wall', friction: 0, restitution: 0.72, angle: Math.atan2(dy, dx) }
    );
  }

  // ─── Corridor Visual ─────────────────────────────────────
  drawCorridor(machineW) {
    const sideW   = (GAME_WIDTH - machineW) / 2;
    const bwLeft  = sideW;
    const bwRight = GAME_WIDTH - sideW;
    const bwTop   = 0;
    const bwBot   = BACK_WALL_BOTTOM_Y;
    const cx      = GAME_WIDTH / 2;

    // ── Corridor background ──────────────────────────────
    const bg = this.corridorBg;
    bg.clear();

    // Back wall (light area behind the hoop)
    bg.fillStyle(0xdfe4ea, 1);
    bg.fillRect(bwLeft, bwTop, machineW, bwBot - bwTop);

    // Subtle back wall inner rectangle (court floor markings)
    bg.fillStyle(0xc8d0da, 0.35);
    bg.fillRect(bwLeft + 8, bwBot - 60, machineW - 16, 55);

    // Corridor floor (trapezoid from back wall bottom to screen bottom)
    bg.fillStyle(0xc8c8c0, 1);
    bg.fillPoints([
      { x: bwLeft,      y: bwBot },
      { x: bwRight,     y: bwBot },
      { x: GAME_WIDTH,  y: COURT_FLOOR_Y },
      { x: 0,           y: COURT_FLOOR_Y },
    ], true);

    // Perspective floor lines (converging to vanishing point)
    const vpX = cx, vpY = bwBot;
    const numLines = 6;
    bg.lineStyle(1, 0x999988, 0.3);
    for (let i = 1; i < numLines; i++) {
      const t    = i / numLines;
      const botX = t * GAME_WIDTH;
      const topX = vpX + (botX - vpX) * 0.05;
      bg.beginPath();
      bg.moveTo(botX, COURT_FLOOR_Y);
      bg.lineTo(topX, vpY);
      bg.strokePath();
    }

    // Back wall border
    bg.lineStyle(2, 0xaab0bb, 0.8);
    bg.strokeRect(bwLeft, bwTop, machineW, bwBot - bwTop);

    // Corridor edges (back wall bottom → screen bottom edges)
    bg.lineStyle(2, 0x888880, 0.6);
    bg.beginPath(); bg.moveTo(bwLeft,  bwBot); bg.lineTo(0,          COURT_FLOOR_Y); bg.strokePath();
    bg.beginPath(); bg.moveTo(bwRight, bwBot); bg.lineTo(GAME_WIDTH, COURT_FLOOR_Y); bg.strokePath();

    // ── Machine side panels (dark overlay, drawn after ball) ──
    const po = this.panelOverlay;
    po.clear();

    // Left panel: polygon from screen-left to back-wall-left
    po.fillStyle(0x111520, 1);
    po.fillPoints([
      { x: 0,      y: 0 },
      { x: bwLeft, y: 0 },
      { x: bwLeft, y: bwBot },
      { x: 0,      y: COURT_FLOOR_Y },
    ], true);
    // Right panel
    po.fillPoints([
      { x: GAME_WIDTH, y: 0 },
      { x: bwRight,    y: 0 },
      { x: bwRight,    y: bwBot },
      { x: GAME_WIDTH, y: COURT_FLOOR_Y },
    ], true);

    // Panel inner edge highlight (depth feel)
    po.lineStyle(2, COLORS.gold, 0.18);
    po.beginPath(); po.moveTo(bwLeft,  0); po.lineTo(bwLeft,  bwBot); po.lineTo(0,          COURT_FLOOR_Y); po.strokePath();
    po.beginPath(); po.moveTo(bwRight, 0); po.lineTo(bwRight, bwBot); po.lineTo(GAME_WIDTH, COURT_FLOOR_Y); po.strokePath();

    // Update upper vertical wall positions
    if (this.upperLeftWall && this.upperRightWall) {
      this.matter.body.setPosition(this.upperLeftWall,  { x: bwLeft  - WALL_THICK / 2, y: BACK_WALL_BOTTOM_Y / 2 });
      this.matter.body.setPosition(this.upperRightWall, { x: bwRight + WALL_THICK / 2, y: BACK_WALL_BOTTOM_Y / 2 });
    }
  }

  // ─── Rim + Backboard ─────────────────────────────────────
  buildRim() {
    const diff = DIFFICULTY[this.currentDifficulty];
    const cx = diff.rimX;
    const cy = diff.rimY;   // 280
    const rw = diff.rimWidth;

    // Graphics (rim drawn ABOVE corridorBg but BELOW panelOverlay)
    this.rimGraphics = this.add.graphics();
    this.netGraphics = this.add.graphics();

    this.drawBackboard(cx, cy, rw);
    this.drawRim(cx, cy, rw);
    this.drawNet(cx, cy, rw);

    // Physics rim pegs
    this.leftRimBody = this.matter.add.rectangle(
      cx - rw / 2, cy, RIM_THICK, RIM_THICK,
      { isStatic: true, label: 'rim', friction: 0.2, restitution: 0.55 }
    );
    this.rightRimBody = this.matter.add.rectangle(
      cx + rw / 2, cy, RIM_THICK, RIM_THICK,
      { isStatic: true, label: 'rim', friction: 0.2, restitution: 0.55 }
    );

    // Goal sensor
    this.goalSensor = this.matter.add.rectangle(
      cx, cy + 22, rw - 16, 10,
      { isStatic: true, isSensor: true, label: 'goal' }
    );

    this.rimCenterX  = cx;
    this.rimCenterY  = cy;
    this.rimWidth    = rw;

    // LED Scoreboard (above backboard)
    this._buildScoreboard(cx, cy, rw);
  }

  _buildScoreboard(cx, cy, rw) {
    const sbW = Math.max(rw + 40, 150);
    const sbH = 70;
    const sbY = cy - 175;

    // Board background (black rounded rect — drawn on rimGraphics layer)
    this.rimGraphics.fillStyle(0x0a0a0a, 1);
    this.rimGraphics.fillRoundedRect(cx - sbW / 2, sbY, sbW, sbH, 10);
    this.rimGraphics.lineStyle(2, COLORS.gold, 0.5);
    this.rimGraphics.strokeRoundedRect(cx - sbW / 2, sbY, sbW, sbH, 10);

    // Multiplier text
    this.ledText = this.add.text(cx, sbY + sbH / 2, '1.0x', {
      fontFamily: 'DM Mono, monospace',
      fontSize: '38px',
      fontStyle: 'bold',
      color: '#e03030',
      shadow: { offsetX: 0, offsetY: 0, color: '#ff0000', blur: 12, fill: true },
    }).setOrigin(0.5);
  }

  drawBackboard(cx, cy, rw) {
    const g   = this.rimGraphics;
    const bW  = rw + 70;
    const bH  = 110;
    const bY  = cy - 90;

    // Backboard body
    g.fillStyle(0xf0ece0, 1);
    g.fillRect(cx - bW / 2, bY, bW, bH);

    // Backboard border
    g.lineStyle(3, 0xcc2222, 1);
    g.strokeRect(cx - bW / 2, bY, bW, bH);

    // Inner target rectangle
    const iW = rw + 10, iH = 50;
    g.lineStyle(2.5, 0xcc2222, 1);
    g.strokeRect(cx - iW / 2, cy - 45, iW, iH);

    // Backboard support bracket
    g.fillStyle(0x2c3e50, 1);
    g.fillRect(cx - 18, bY - 30, 36, 34);
    g.fillStyle(0x1a252f, 1);
    g.fillRect(cx - 6, bY - 60, 12, 35);
  }

  drawRim(cx, cy, rw) {
    const g = this.rimGraphics;
    g.lineStyle(RIM_THICK, COLORS.rimMetal, 1);
    g.beginPath();
    g.moveTo(cx - rw / 2, cy);
    g.lineTo(cx + rw / 2, cy);
    g.strokePath();
    g.fillStyle(COLORS.rimMetal, 1);
    g.fillCircle(cx - rw / 2, cy, RIM_THICK / 2);
    g.fillCircle(cx + rw / 2, cy, RIM_THICK / 2);
  }

  drawNet(cx, cy, rw) {
    const g       = this.netGraphics;
    g.clear();
    const segments  = 7;
    const bottomW   = rw * 0.45;
    const netH      = NET_HEIGHT;

    g.lineStyle(1.2, 0xcccccc, 0.55);
    for (let i = 0; i <= segments; i++) {
      const t    = i / segments;
      const topX = cx - rw / 2 + t * rw;
      const botX = cx - bottomW / 2 + t * bottomW;
      g.beginPath(); g.moveTo(topX, cy + 4); g.lineTo(botX, cy + netH); g.strokePath();
    }
    for (let row = 1; row <= 4; row++) {
      const t    = row / 5;
      const y    = cy + 4 + t * netH;
      const wAtY = rw - (rw - bottomW) * t;
      const x0   = cx - wAtY / 2;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + wAtY, y); g.strokePath();
    }
  }

  // ─── Ball ─────────────────────────────────────────────────
  buildBall() {
    const startX = GAME_WIDTH / 2;
    const startY = COURT_FLOOR_Y - 80; // near bottom of corridor

    this.ballStartX = startX;
    this.ballStartY = startY;

    this.ballBody = this.matter.add.circle(startX, startY, BALL_RADIUS, {
      restitution: 0.78, friction: 0.25, frictionAir: 0.008,
      density: 0.003, label: 'ball',
    });
    this.matter.body.setStatic(this.ballBody, true);

    this.ballGraphics = this.add.graphics();
    this._redrawBall(startX, startY, false);

    // panelOverlay must stay on top of ball — re-add it last
    // (already created in buildCourt before ball, so ball is above it)
    // We bring panelOverlay to top after ball is created
    this.panelOverlay.setDepth(10);
    this.ballGraphics.setDepth(5);

    this.matter.world.on('collisionstart', this.onCollision, this);
  }

  _perspRadius(y) {
    const t = Phaser.Math.Clamp(
      (y - BACK_WALL_BOTTOM_Y) / (COURT_FLOOR_Y - BACK_WALL_BOTTOM_Y), 0, 1
    );
    return Phaser.Math.Linear(BALL_R_FAR, BALL_R_NEAR, t);
  }

  _redrawBall(x, y, glowing) {
    const g = this.ballGraphics;
    g.clear();
    const r = this._perspRadius(y);

    if (glowing) {
      g.fillStyle(COLORS.gold, 0.18);
      g.fillCircle(x, y, r + 12);
    }
    // Ball body
    g.fillStyle(COLORS.ball, 1);
    g.fillCircle(x, y, r);

    // Highlight
    g.fillStyle(0xffffff, 0.22);
    g.fillCircle(x - r * 0.28, y - r * 0.28, r * 0.38);

    // Seams
    g.lineStyle(Math.max(1, r * 0.06), 0x000000, 0.35);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.strokePath();
    g.lineStyle(Math.max(1, r * 0.05), 0x000000, 0.28);
    g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.strokePath();
    g.beginPath(); g.arc(x, y, r * 0.55, -Math.PI * 0.3, Math.PI * 1.3); g.strokePath();
  }

  resetBall() {
    this.matter.body.setPosition(this.ballBody, { x: this.ballStartX, y: this.ballStartY });
    this.matter.body.setVelocity(this.ballBody, { x: 0, y: 0 });
    this.matter.body.setAngularVelocity(this.ballBody, 0);
    this.matter.body.setStatic(this.ballBody, true);
    this._redrawBall(this.ballStartX, this.ballStartY, false);
    this.ballPassedRimTop = false;
  }

  // ─── UI ───────────────────────────────────────────────────
  buildUI() {
    const w = GAME_WIDTH;
    const barY = GAME_HEIGHT - 56;

    // Top bar
    this.add.rectangle(w / 2, 22, w, 44, 0x000000, 0.65).setDepth(20);
    this.balanceText = this.add.text(14, 10, `餘額 $${this.balance.toLocaleString()}`, {
      fontFamily: 'DM Mono, monospace', fontSize: '13px', color: '#ffffff', alpha: 0.7,
    }).setDepth(20);
    this.diffBtn = this.add.text(w - 14, 10, '簡單', {
      fontFamily: 'Syne, sans-serif', fontSize: '13px', color: '#c9a84c',
      backgroundColor: '#c9a84c22', padding: { x: 10, y: 4 },
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true }).setDepth(20);
    this.diffBtn.on('pointerup', () => this.cycleDifficulty());

    // Bottom bar
    this.add.rectangle(w / 2, barY, w, 80, 0x000000, 0.80).setDepth(20);

    this.add.text(14, GAME_HEIGHT - 82, '投注', {
      fontFamily: 'DM Mono, monospace', fontSize: '11px', color: '#ffffff', alpha: 0.5,
    }).setDepth(20);
    this.betText = this.add.text(14, GAME_HEIGHT - 65, `$${this.betAmount}`, {
      fontFamily: 'DM Mono, monospace', fontSize: '20px', color: '#ffffff',
    }).setInteractive({ useHandCursor: true }).setDepth(20);
    this.betText.on('pointerup', () => this.cycleBet());
    this.betHint = this.add.text(14, GAME_HEIGHT - 42, '點擊更改', {
      fontFamily: 'DM Mono, monospace', fontSize: '9px', color: '#c9a84c', alpha: 0.5,
    }).setDepth(20);

    // Bottom center: current multiplier
    this.multText = this.add.text(w / 2, GAME_HEIGHT - 65, '1.0x', {
      fontFamily: 'DM Mono, monospace', fontSize: '22px', color: '#c9a84c',
    }).setOrigin(0.5, 0).setDepth(20);

    // Dots (right side)
    this.dotsContainer = this.add.container(w - 14, barY).setDepth(20);
    this.updateDots();

    // Cashout button
    this.cashoutBtn = this.add.text(w / 2, GAME_HEIGHT - 16, '', {
      fontFamily: 'Syne, sans-serif', fontSize: '17px', color: '#080b10',
      backgroundColor: '#c9a84c', padding: { x: 28, y: 10 },
    }).setOrigin(0.5, 1).setInteractive({ useHandCursor: true }).setAlpha(0).setDepth(20);
    this.cashoutBtn.on('pointerup', () => this.cashout());

    // Swipe hint
    this.hintText = this.add.text(w / 2, COURT_FLOOR_Y - 50, '長壓球體上滑投球', {
      fontFamily: 'Syne, sans-serif', fontSize: '12px', color: '#c9a84c', alpha: 0.45,
    }).setOrigin(0.5).setDepth(20);
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
      const cashout = Math.floor(this.betAmount * mult);
      this.cashoutBtn.setText(`兌現 $${cashout}  →`);
      this.tweens.add({ targets: this.cashoutBtn, alpha: 1, duration: 200 });
    }
  }

  updateBalanceDisplay() {
    this.balanceText.setText(`餘額 $${this.balance.toLocaleString()}`);
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
  }

  lockBet() {
    if (this.betDeducted) return;
    this.betDeducted = true;
    this.balance -= this.betAmount;
    this.updateBalanceDisplay();
    this.betHint.setAlpha(0);
  }

  // ─── Difficulty ───────────────────────────────────────────
  cycleDifficulty() {
    if (this.gameState !== 'idle' || this.betDeducted) return;
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

    const proxy = { rimW: this.rimWidth, machineW: this.machineWidth };

    this.tweens.add({
      targets: proxy,
      rimW: diff.rimWidth, machineW: diff.machineWidth,
      duration: 480, ease: 'Cubic.InOut',
      onUpdate: () => {
        this.rimGraphics.clear();
        this.drawBackboard(diff.rimX, diff.rimY, proxy.rimW);
        this._buildScoreboard(diff.rimX, diff.rimY, proxy.rimW);
        this.drawRim(diff.rimX, diff.rimY, proxy.rimW);
        this.drawNet(diff.rimX, diff.rimY, proxy.rimW);
        this.drawCorridor(proxy.machineW);
      },
      onComplete: () => {
        this.rimWidth    = diff.rimWidth;
        this.machineWidth = diff.machineWidth;
        this.rimCenterX  = diff.rimX;
        this.rimCenterY  = diff.rimY;
        this._updateRimPhysics(diff);
        this._rebuildAngledWalls(diff.machineWidth);

        this.ballsScored = 0;
        this.betDeducted = false;
        this.betHint.setAlpha(0.5);
        this.updateDots();
        this.cashoutBtn.setAlpha(0);
        this.multText.setText('1.0x');
        if (this.ledText) this.ledText.setText('1.0x');
        this.gameState = 'idle';
      },
    });
  }

  _updateRimPhysics(diff) {
    this.matter.body.setPosition(this.leftRimBody,  { x: diff.rimX - diff.rimWidth / 2, y: diff.rimY });
    this.matter.body.setPosition(this.rightRimBody, { x: diff.rimX + diff.rimWidth / 2, y: diff.rimY });
    this.matter.body.setPosition(this.goalSensor,   { x: diff.rimX, y: diff.rimY + 22 });
  }

  // ─── Input ────────────────────────────────────────────────
  setupInput() {
    this.dragStart    = null;
    this.isDragging   = false;
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
      this._redrawBall(bx, by, true);
      this.hintText.setAlpha(0);
    }
  }

  onPointerMove(pointer) {
    if (!this.isDragging) return;
    const { x, y } = this.ballBody.position;
    this._redrawBall(x, y, true);
  }

  onPointerUp(pointer) {
    if (!this.isDragging) return;
    this.isDragging = false;
    const dx = pointer.x - this.dragStart.x;
    const dy = pointer.y - this.dragStart.y;
    if (dy > -30) {
      const { x, y } = this.ballBody.position;
      this._redrawBall(x, y, false);
      return;
    }
    this.shoot(dx, dy);
  }

  shoot(dx, dy) {
    this.lockBet();
    this.gameState = 'flying';
    this.matter.body.setStatic(this.ballBody, false);
    const vx = Phaser.Math.Clamp(dx * 0.30, -25, 25);
    const vy = Phaser.Math.Clamp(dy * 0.30, -55, -8);
    this.matter.body.setVelocity(this.ballBody, { x: vx, y: vy });
    this.ballPassedRimTop = false;
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
  update() {
    if (this.gameState !== 'flying') return;
    const { x: bx, y: by } = this.ballBody.position;
    this._redrawBall(bx, by, false);

    // Goal detection
    if (!this.ballPassedRimTop && by < this.rimCenterY)       this.ballPassedRimTop = true;
    if (this.ballPassedRimTop && by > this.rimCenterY + 10 && by < this.rimCenterY + 55) {
      const rimLeft  = this.rimCenterX - this.rimWidth / 2 + 10;
      const rimRight = this.rimCenterX + this.rimWidth / 2 - 10;
      if (bx > rimLeft && bx < rimRight) this.triggerScore();
    }

    if (by > GAME_HEIGHT + 100) this.triggerFail();
  }

  // ─── Game Logic ───────────────────────────────────────────
  triggerScore() {
    if (this.gameState !== 'flying') return;
    this.gameState = 'scored';
    this.ballsScored++;

    this.tweens.add({
      targets: this.netGraphics, x: { from: -3, to: 3 },
      yoyo: true, repeat: 4, duration: 55,
    });

    this.updateMultiplierDisplay();
    this.updateDots();

    // LED pop animation
    if (this.ledText) {
      this.tweens.add({ targets: this.ledText, scaleX: 1.25, scaleY: 1.25, yoyo: true, duration: 130 });
    }
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

    const overlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.failure, 0.35).setDepth(30);
    this.tweens.add({ targets: overlay, alpha: 0, duration: 600, onComplete: () => overlay.destroy() });

    const failText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `沒進\n-$${this.betAmount}`, {
      fontFamily: 'Syne, sans-serif', fontSize: '28px', color: '#c95a4c', align: 'center',
    }).setOrigin(0.5).setAlpha(0).setDepth(30);

    this.tweens.add({
      targets: failText, alpha: 1, duration: 300, hold: 1200, yoyo: true,
      onComplete: () => { failText.destroy(); this.endRound(); },
    });
  }

  cashout() {
    if (this.gameState !== 'idle' || this.ballsScored === 0) return;
    const mults  = MULTIPLIERS[this.currentDifficulty];
    const payout = Math.floor(this.betAmount * mults[Math.min(this.ballsScored, mults.length - 1)]);
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
    this.ballsScored = 0;
    this.betDeducted = false;
    this.updateDots();
    this.multText.setText('1.0x');
    if (this.ledText) this.ledText.setText('1.0x');
    this.cashoutBtn.setAlpha(0);
    this.hintText.setAlpha(0.45);
    this.betHint.setAlpha(0.5);
    while (this.betAmount > this.balance && this.betIndex > 0) {
      this.betIndex--;
      this.betAmount = this.betPresets[this.betIndex];
    }
    this.betText.setText(`$${this.betAmount}`);
    this.resetBall();
    this.gameState = 'idle';
  }
}
