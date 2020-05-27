// This is the audio manager that carries all of them tunes in it

import  * as Howler from '../node_modules/howler/dist/howler.js';

var LevelAudioManager = function(){
    this.bgmName="♫ Young Presidents - Night Drive Synthwave";
    this.bmg;
    this.laser;
    this.sprites;
    this.analyser;
    this.bpm=100;
}

LevelAudioManager.prototype.loadLevelAudio = function (){
	this.bmg = new Howl({
        src: ['../assets/audio/263_full_night-drive-synthwave_0168_preview.mp3'],
        loop:true
      });
    
    this.bmp=100;
    
      this.laser = new Howl({
        src: ['../assets/audio/effects/laser6a.ogg']
      });

      this.sprites  = new Howl({
        src: ['../assets/audio/263_full_night-drive-synthwave_0168_preview.mp3'],
        sprite: {
          drum1: [160825, 161431],
          drum2: [161278, 161821],
          intro: [0o40, 9653]
        }
      });

    };

    
LevelAudioManager.prototype.createAnalyser = function (){
    
  
	this.analyser = Howler.ctx.createAnalyser();
    // Connect the masterGain -> analyser (disconnecting masterGain -> destination)
    Howler.masterGain.connect(this.analyser);
    this.analyser.fftSize = 2048;
    var bufferLength = this.analyser.frequencyBinCount;
    var dataArray = new Uint8Array(bufferLength);
  
    // Get the Data array
    this.analyser.getByteTimeDomainData(dataArray);
  
    // Display array on time each 3 sec (just to debug)
    // setInterval(function(){ 
    //   this.analyser.getByteTimeDomainData(dataArray);
    //   console.dir(dataArray);
    // }, 3000);
};

    /// Spectrumn analyzer from Szenia Zadvornykh
    // https://codepen.io/zadvorsky/pen/vNVNYr   
    
    function SpectrumAnalyzer(binCount, smoothingTimeConstant) {
        var Context = window["AudioContext"] || window["webkitAudioContext"];
      
        this.context = new Context();
        this.analyzerNode = this.context.createAnalyser();
      
        this.setBinCount(binCount);
        this.setSmoothingTimeConstant(smoothingTimeConstant);
      }
      
      SpectrumAnalyzer.prototype = {
        setSource: function (source) {
          //this.source = source;
          this.source = this.context.createMediaElementSource(source);
          this.source.connect(this.analyzerNode);
          this.analyzerNode.connect(this.context.destination);
        },
      
        setBinCount: function (binCount) {
          this.binCount = binCount;
          this.analyzerNode.fftSize = binCount * 2;
      
          this.frequencyByteData = new Uint8Array(binCount); 	// frequency
          this.timeByteData = new Uint8Array(binCount);		// waveform
        },
      
        setSmoothingTimeConstant: function (smoothingTimeConstant) {
          this.analyzerNode.smoothingTimeConstant = smoothingTimeConstant;
        },
      
        getFrequencyData: function () {
          return this.frequencyByteData;
        },
      
        getTimeData: function () {
          return this.timeByteData;
        },
        // not save if out of bounds
        getAverage: function (index, count) {
          var total = 0;
          var start = index || 0;
          var end = start + (count || this.binCount);
      
          for (var i = start; i < end; i++) {
            total += this.frequencyByteData[i];
          }
      
          return total / (end - start);
        },
        getAverageFloat:function(index, count) {
          return this.getAverage(index, count) / 255;
        },
      
        updateSample: function () {
          this.analyzerNode.getByteFrequencyData(this.frequencyByteData);
          this.analyzerNode.getByteTimeDomainData(this.timeByteData);
        }
      };


export { LevelAudioManager, SpectrumAnalyzer };