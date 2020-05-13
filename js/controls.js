
export var MOUSEPOS;
export var SPEED=0;

export var GameLoopControls = function(h, w){
    this.mouseX;
    this.mouseY;
    this.mousePos;
    this.lastKeyPressed;
    this.height = h;
    this.width = w;

    console.log(h, w, this.height, this.width);
    document.addEventListener('mousemove', this.handleMouseMove, false);
	document.addEventListener('keydown', this.handleKeyDown);	
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
}

GameLoopControls.prototype.handleKeyDown = function(event){
    if(event.key=="w"){
        console.log("w")
        SPEED+=1;
    }
    if(event.key=="s"){
        console.log("w")
        SPEED-=1;
    }
    if(event.keyCode==32){
        console.log("SPACE");
    }
}

