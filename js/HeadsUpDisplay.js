
var HeadsUpDisplay = function(){
	//this.speedometer = document.createElement("div");
	//this.speedometer.setAttribute("id", "speedo");
	//this.speedometerElementId = "speedo";
	this.speedo = document.getElementById("speedo");
}

HeadsUpDisplay.prototype.updateSpeed = function (speed){
	//console.log("SPEEED ",speed);
	//var speedo = document.getElementById("speedo");
	this.speedo.textContent = speed;
}

export { HeadsUpDisplay };