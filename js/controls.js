import * as THREE from '../node_modules/three/build/three.module.js'

export var MOUSEPOS = {x:0, y:0};
export var RAWMOUSE = {x:0, y:0};
export var SPEED=0;
export var BULLETS=0;
export var COUNTX=0;
export var COUNTY=0;
export var COUNTZ=0;
var x;
var y;
var rotationX=0;
var rotationY=0;

//max right up 1.2945732784677597 2.0642676535897904 1.465160639062555 1.587605153589793
//max right down  1.1650714197316931 2.3228801535898103  1.0845063639696175 2.0794426535897754 
//left 1.686335360252154 3.945692653589709 1.9252201186164533 4.093717653589795

export var GameLoopControls = function(h, w){
    this.mouseX;
    this.mouseY;
    this.mousePos;
    this.lastKeyPressed;
    this.height = h;
    this.width = w;

    //Listen to mouse and keyboard
    document.addEventListener('mousemove', this.handleMouseMove, false);
   // document.addEventListener("mousedown", this.handleMouseDown, false);
    //document.addEventListener('keydown', this.handleKeyDown);	
    //document.addEventListener('keyup', this.handleKeyUp);	
}
GameLoopControls.prototype.getMousePos = function(){
    return this.mousePos;
}

GameLoopControls.prototype.getWindowHeight = function(){
    return this.height;
}

GameLoopControls.prototype.getWindowWidth = function(){
    return this.width;
}

GameLoopControls.prototype.setRotationX = function(rx){
    rotationX=rx;
}
GameLoopControls.prototype.setRotationY = function(ry){
    rotationY=ry;
}

GameLoopControls.prototype.getRotationX = function(rx){
    rotationX=rx;
}
GameLoopControls.prototype.getRotationY = function(ry){
    rotationY=ry;
}
export var setBullets = function(bc){
    BULLETS=bc;
}
GameLoopControls.prototype.getSpeed = function(){
    return SPEED;
}



//after getters and setters come the functions

GameLoopControls.prototype.handleMouseMove = function(event){
	// here we are converting the mouse position value received 
	// to a normalized value varying between -1 and 1;
	// this is the formula for the horizontal axis:
	
	var tx = -1 + (event.clientX /  window.innerWidth)*2;

	// for the vertical axis, we need to inverse the formula 
	// because the 2D y-axis goes the opposite direction of the 3D y-axis
	
	var ty = 1 - (event.clientY / window.innerHeight)*2;
    MOUSEPOS = {x:tx, y:ty};

    // move aiming recticle
    document.getElementById("aiming").style.left = event.clientX-50+"px";
    document.getElementById("aiming").style.top = event.clientY-50+"px";

    RAWMOUSE = {x:event.clientX, y:event.clientY};
}

GameLoopControls.prototype.handleMouseDown = function(event){
    // pew pew pew
    console.log("mousedown");
    BULLETS+=1;
  
}

GameLoopControls.prototype.handleKeyDown = function(event){
    

    if(event.key=="w"){
        if (SPEED >= -5) SPEED+=1;
    }
    if(event.key=="s"){
        
        if (SPEED <=100) SPEED-=1;
    }   
    if(event.key=="d"){
        COUNTX-=0.1;
       
    }   
    if(event.key =="a"){
        COUNTX+=0.1;
    }
    //temp xyz debuggint
    if(event.key =="i"){
        COUNTX+=0.1;
    }
    if(event.key =="o"){
        COUNTY+=0.1;
    }
    if(event.key =="p"){
        COUNTZ+=0.1;
    }
    if(event.key =="j"){
        COUNTX-=0.1;
    }
    if(event.key =="k"){
        COUNTY-=0.1;
    }
    if(event.key =="l"){
        COUNTZ-=0.1;
    }
    if(event.keyCode==32){
        console.log(MOUSEPOS);

    }
}
GameLoopControls.prototype.handleKeyUp = function(event){
    

  
    if(event.key=="d"){
        COUNTX=0;
       
    }   
    if(event.key =="a"){
        COUNTX=0;
    }
}
