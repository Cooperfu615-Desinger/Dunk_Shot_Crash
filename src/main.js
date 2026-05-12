import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';
import { GAME_WIDTH, GAME_HEIGHT } from './config/gameConfig.js';

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: 'game-container',
  backgroundColor: '#080b10',
  physics: {
    default: 'matter',
    matter: {
      gravity: { y: 2.2 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GameScene],
};

new Phaser.Game(config);
