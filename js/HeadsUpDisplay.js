
var HeadsUpDisplay = function(){
	//this.speedometer = document.createElement("div");
	//this.speedometer.setAttribute("id", "speedo");
	//this.speedometerElementId = "speedo";
}

HeadsUpDisplay.prototype.updateSpeed = function (speed){
	//console.log("SPEEED ",speed);
	var speedo = document.getElementById("speedo");
	speedo.textContent = speed;
}

export { HeadsUpDisplay };