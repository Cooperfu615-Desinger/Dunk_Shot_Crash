export const GAME_WIDTH = 390;
export const GAME_HEIGHT = 844;

// Perspective corridor layout
export const BACK_WALL_BOTTOM_Y = 550; // 廊道地板與後牆的交界 y
export const COURT_FLOOR_Y = 756;      // 物理地板 y（底部 UI 上方）

export const COLORS = {
  background: 0x080b10,
  gold: 0xc9a84c,
  success: 0x4c9a8a,
  failure: 0xc95a4c,
  rimMetal: 0xc0392b,
  backboard: 0xf0e6d3,
  ball: 0xe8651a,
};

export const DIFFICULTY = {
  easy: {
    label: '簡單',
    rimBodyOffset: 50,   // 籃框碰撞體距中心距離（美術內緣 ≈ 24，加寬給容易版）
    scoringHalf:   40,   // 進球判定半寬（rimBodyOffset - RIM_W/2 = 40）
    rimX: GAME_WIDTH / 2,
    rimY: 341,   // 校準至美術圖 rim.png 的像素位置
    machineWidth: 282,  // 校準至 panel-overlay 走廊寬度
    rimMove: false,
    elasticityRange: [0.70, 0.90],
    boardAngleRange: [-3, 3],
    wallRange: [0.70, 0.85],
    maxMultiplier: 10,
  },
  normal: {
    label: '普通',
    rimBodyOffset: 38,
    scoringHalf:   28,
    rimX: GAME_WIDTH / 2,
    rimY: 341,
    machineWidth: 230,
    rimMove: true,
    rimMoveSpeed: 60,
    rimMoveRange: 10,
    elasticityRange: [0.40, 0.90],
    boardAngleRange: [-8, 8],
    wallRange: [0.45, 0.88],
    maxMultiplier: 20,
  },
  hard: {
    label: '困難',
    rimBodyOffset: 33,
    scoringHalf:   23,
    rimX: GAME_WIDTH / 2,
    rimY: 341,
    machineWidth: 180,
    rimMove: true,
    rimMoveSpeed: 140,
    rimMoveRange: 25,
    elasticityRange: [0.20, 0.95],
    boardAngleRange: [-15, 15],
    wallRange: [0.25, 0.92],
    maxMultiplier: 150,
  },
};

export const MULTIPLIERS = {
  easy:   [0, 1.1, 1.2, 1.4, 1.5, 1.8, 2.2, 2.8, 3.2, 4.0, 5.5, 7.0, 10],
  normal: [0, 1.3, 1.6, 2.2, 2.9, 4.0, 5.5, 7.5, 10, 14, 20],
  hard:   [0, 1.8, 2.8, 5.0, 8.0, 15, 25, 40, 60, 100, 150],
};
