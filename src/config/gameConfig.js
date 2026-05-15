export const GAME_WIDTH = 390;
export const GAME_HEIGHT = 700;

// Perspective corridor layout
export const BACK_WALL_BOTTOM_Y = 580; // 廊道地板與後牆的交界 y
export const COURT_FLOOR_Y = 580;      // 物理地板 y（底部 UI 上方）

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
    rimBodyOffset: 52,   // 內緣間距 = 2×52-20 = 84px > 球徑 66px
    scoringHalf: 42,
    rimX: GAME_WIDTH / 2,
    rimY: 275,
    machineWidth: 340,
    rimMove: false,
    elasticityRange: [0.70, 0.90],
    boardAngleRange: [-3, 3],
    wallRange: [0.70, 0.85],
    maxMultiplier: 10,
  },
  normal: {
    label: '普通',
    rimBodyOffset: 48,   // 內緣間距 = 2×48-20 = 76px > 球徑 66px
    scoringHalf: 36,
    rimX: GAME_WIDTH / 2,
    rimY: 275,
    machineWidth: 340,
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
    rimBodyOffset: 44,   // 內緣間距 = 2×44-20 = 68px > 球徑 66px（窄但可過）
    scoringHalf: 28,
    rimX: GAME_WIDTH / 2,
    rimY: 275,
    machineWidth: 340,
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
  easy: [0, 1.1, 1.2, 1.4, 1.5, 1.8, 2.2, 2.8, 3.2, 4.0, 5.5, 7.0, 10],
  normal: [0, 1.3, 1.6, 2.2, 2.9, 4.0, 5.5, 7.5, 10, 14, 20],
  hard: [0, 1.8, 2.8, 5.0, 8.0, 15, 25, 40, 60, 100, 150],
};
