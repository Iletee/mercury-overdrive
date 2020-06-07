
var HeadsUpDisplay = function(){
	//this.speedometer = document.createElement("div");
	//this.speedometer.setAttribute("id", "speedo");
	//this.speedometerElementId = "speedo";
	this.speedo = document.getElementById("speedo");
	this.healthMeter;
	this.scoreMeter;
	this.topLeftContainer;
	this.chicklets = [];

}

HeadsUpDisplay.prototype.createHud = function(health){
	this.topLeftContainer= document.createElement("div");
	this.healthMeter = document.createElement("div");
	this.scoreMeter = document.createElement("div");
	this.speedo = document.createElement("div");
	this.gunShow = document.createElement("div");


	this.topLeftContainer.id="tlc";
	this.healthMeter.id = "healthmeter";
	this.scoreMeter.id = "scoremeter";
	this.speedo.id ="speedo";

	this.gunShow.id ="gunshow";

	document.body.appendChild(this.topLeftContainer);
	document.body.appendChild(this.healthMeter);
	document.body.appendChild(this.speedo);
	document.body.appendChild(this.gunShow);

	console.log("creathuD",health);

	document.getElementById(this.topLeftContainer.id).appendChild(this.scoreMeter);
	document.getElementById(this.topLeftContainer.id).appendChild(this.healthMeter);

	for(let i=0; i<health;  i+=1){
		var chicklet = document.createElement("div");
		chicklet.classList.add("hpc");
		chicklet.textContent = " ";
		//chicklet.id = "hpc%s" % i;
		document.getElementById(this.healthMeter.id).appendChild(chicklet);
		this.chicklets.push(chicklet);
	}

	
}

HeadsUpDisplay.prototype.updateSpeed = function (speed){
	//console.log("SPEEED ",speed);
	//var speedo = document.getElementById("speedo");
	this.speedo.textContent = speed;
}

HeadsUpDisplay.prototype.updateScore = function (score){
	//console.log("SPEEED ",speed);
	//var speedo = document.getElementById("speedo");
	this.scoreMeter.textContent = "SCORE "+score;
}

HeadsUpDisplay.prototype.updateHealth = function (health){
	//this.healthMeter.textContent = health;
	const myNode = document.getElementById(this.healthMeter.id);
	while (myNode.firstChild) {
		myNode.removeChild(myNode.lastChild);
	}
	for(let i=0; i<health;  i+=1){
		var chicklet = document.createElement("div");
		chicklet.classList.add("hpc");
		chicklet.textContent = " ";
		//chicklet.id = "hpc%s" % i;
		myNode.appendChild(chicklet);
		this.chicklets.push(chicklet);
	}

}

HeadsUpDisplay.prototype.updateGunAmmo = function (){
	this.gunShow.textContent = "MAIN LASER ∞";
}


export { HeadsUpDisplay };