// This is the audio manager that carries all of them tunes in it

import  * as Howler from '../node_modules/howler/dist/howler.js';

var LevelAudioManager = function(){
    this.bgmName="♫ Young Presidents - Night Drive Synthwave";
    this.bmg;
    this.laser;
}

LevelAudioManager.prototype.loadLevelAudio = function (){
	this.bmg = new Howl({
        src: ['../assets/audio/263_full_night-drive-synthwave_0168_preview.mp3'],
        loop:true
      });
    
      this.laser = new Howl({
        src: ['../assets/audio/effects/laser6a.ogg']
      });

    };


export { LevelAudioManager };