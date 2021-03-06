import * as THREE from '../node_modules/three/build/three.module.js'
import { FlyControls } from './FlyControls.js';
import { HeadsUpDisplay } from './HeadsUpDisplay.js';
import { LevelAudioManager } from './audio.js';
import { Sky, Cloud, Planet, Mysterysplosion } from './spaceprops.js';
import { Colors, Enemy1 } from './store.js';

import  * as Howler from '../node_modules/howler/dist/howler.js';
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
//import * as GameLoopControls from './controls.js';
import { UnrealBloomPass } from '../node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from '../node_modules/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../node_modules/three/examples/jsm/postprocessing/RenderPass.js';
import { GameLoopControls } from './controls.js';
//import { BloomPass } from './node_modules/three/examples/jsm/postprocessing/BloomPass.js';

//these are used for collision detection
var collidableMesh=[];
var heroMesh=[];

//post processing params... need a better system
var params = {
	exposure: 0.8,
	bloomStrength: 1.0,
	bloomThreshold: 0.7,
	bloomRadius: 0.45
};

window.addEventListener('load', init, false);

var clock;
var state=1;
var beatCount=0;

function init() {
    // set up the scene, the camera and the renderer
   
	createScene();
	
	// add the lights
	createLights();

	// add the objects
    //createPlane();
	createShip();
	
	//createSea();
	createSky();
	createHud();
    
	//add the listenersw
	createControls();
	//controls = new GameLoopControls.GameLoopControls(window.innerHeight, window.innerWidth);


    // Play music
    audiomanager.bmg.once('load', function(){
				audiomanager.bmg.play();
				//audiomanager.createAnalyser();
				beatTimer();
				document.getElementById("loading").classList.add('hidden');

				//document.getElementById("starter").classList.add('hidden');

				//Hide texts and present game
				//createControls();
				//console.log(GameLoopControls.MOUSEPOS);
				spaceship.mesh.position.copy(camera.position);
				spaceship.mesh.translateX(30);
				spaceship.mesh.translateY(-15);
				spaceship.mesh.translateZ(10);
				//spaceship.mesh.material= THREE.MeshStandardMaterial({color: 0xff0000});

				spaceship.mesh.rotation.copy(camera.rotation);
				spaceship.mesh.rotation.x+=Math.PI / 2; //radiansss
				spaceship.mesh.rotation.y+=Math.PI; //radiansss
				clock = new THREE.Clock();
				
				//@todo put this to music manager
				//@todo music manager 
			
				var music = document.getElementById("music");
				music.textContent=audiomanager.bgmName;
				
				loop();
				document.getElementById("title").classList.add('hidden');
				document.getElementById("music").classList.add('hidden-slow');
	
      });
	// start a loop that will update the objects' positions 
	// and render the scene on each frame    
}

var hud;

function createHud(){
	hud = new HeadsUpDisplay();
	hud.createHud(spaceship.hp);
	
}

var scene,
		camera, fieldOfView, aspectRatio, nearPlane, farPlane, HEIGHT, WIDTH,
		renderer, container,composer;

function createScene() {
	// Get the width and the height of the screen,
	// use them to set up the aspect ratio of the camera 
	// and the size of the renderer.
	HEIGHT = window.innerHeight;
	WIDTH = window.innerWidth;

	// Create the scene
	scene = new THREE.Scene();

	// Add a fog effect to the scene; same color as the
	// background color used in the style sheet
	//scene.fog = new THREE.Fog(0xf7d9aa, 100, 950);
	
	// Create the camera
	aspectRatio = WIDTH / HEIGHT;
	fieldOfView = 60;
	nearPlane = 1;
	farPlane = 10000;

	const loader = new THREE.CubeTextureLoader();
    const texture = loader.load([
		'../assets/models/skybox/purple/mercury_left.png',
	  '../assets/models/skybox/purple/mercury_right.png',
	 
	  '../assets/models/skybox/purple/mercury_up.png',
	  '../assets/models/skybox/purple/mercury_down.png',
   
      '../assets/models/skybox/purple/mercury_front.png',
      '../assets/models/skybox/purple/mercury_back.png',
      
    ]);
    scene.background = texture;

	camera = new THREE.PerspectiveCamera(
		fieldOfView,
		aspectRatio,
		nearPlane,
		farPlane
		);
	
	// Set the position of the camera
	camera.position.x = 0;
	camera.position.z = 0;
	camera.position.y = 0;

	// Create the renderer
	renderer = new THREE.WebGLRenderer({ 
		// Allow transparency to show the gradient background
		// we defined in the CSS
		alpha: false, 

		// Activate the anti-aliasing; this is less performant,
		// but, as our project is low-poly based, it should be fine :)
		antialias: false 
	});



	// Define the size of the renderer; in this case,
	// it will fill the entire screen
	renderer.setSize(WIDTH, HEIGHT);
	
	// Enable shadow rendering
	renderer.shadowMap.enabled = true;
	
	// Add the DOM element of the renderer to the 
	// container we created in the HTML
	container = document.getElementById('world');
	container.appendChild(renderer.domElement);
	var renderScene = new RenderPass( scene, camera );

	// This adds blooooom and glow to all bits glowy
	var bloomPass = new UnrealBloomPass(new THREE.Vector2( window.innerWidth, window.innerHeight ),1.5, 1, 0.85);
	
	bloomPass.threshold = params.bloomThreshold;
	bloomPass.strength = params.bloomStrength;
	bloomPass.radius = params.bloomRadius;
	renderer.setPixelRatio( window.devicePixelRatio );

	var renderScene = new RenderPass( scene, camera );
	
	composer = new EffectComposer( renderer );
	composer.addPass( renderScene );
	composer.addPass( bloomPass );

    createSound();
}

//These are threes bulilt in controls well leave em here in case i want it again

var flyControls, shipControls;

function createControls(){

    flyControls = new FlyControls(camera, container);
	//shipControls = new FlyControls(spaceship.mesh, container);
    flyControls.movementSpeed = 200;
    flyControls.domElement = container;
    flyControls.rollSpeed = Math.PI / 20;
    flyControls.autoForward = true;
    flyControls.dragToLook = true;

    

}

var hemisphereLight, shadowLight, ambientLight;

function createLights() {
	// A hemisphere light is a gradient colored light; 
	// the first parameter is the sky color, the second parameter is the ground color, 
	// the third parameter is the intensity of the light
	hemisphereLight = new THREE.HemisphereLight(Colors.darkkblue,Colors.grayblue, .9)
	ambientLight = new THREE.AmbientLight(0xdc8874, .5);

	// A directional light shines from a specific direction. 
	// It acts like the sun, that means that all the rays produced are parallel. 
	shadowLight = new THREE.DirectionalLight(0xffffff, .9);

	// Set the direction of the light  
	// should make a sun in this place.
	shadowLight.position.set(1550, 2550, 3250);
	
	// Allow shadow casting 
	shadowLight.castShadow = true;

	// define the visible area of the projected shadow
	shadowLight.shadow.camera.left = -400;
	shadowLight.shadow.camera.right = 400;
	shadowLight.shadow.camera.top = 400;
	shadowLight.shadow.camera.bottom = -400;
	shadowLight.shadow.camera.near = 1;
	shadowLight.shadow.camera.far = 1000;

	// define the resolution of the shadow; the higher the better, 
	// but also the more expensive and less performant
	shadowLight.shadow.mapSize.width = 2048;
	shadowLight.shadow.mapSize.height = 2048;
	
	// to activate the lights, just add them to the scene
	scene.add(hemisphereLight);  
	scene.add(shadowLight);
	scene.add(ambientLight);
}

// Now we instantiate the sky and push its center a bit
// towards the bottom of the screen

var sky,planet,splosion;

function createSky(){
	sky = new Sky();
	sky.mesh.position.y = -600;
	sky.mesh.position.z = -6000;
    sky.mesh.rotateY(1.57)
	sky.mesh.name="sky";
	scene.add(sky.mesh);
	sky.mesh.userData = {type:"sky"};

	planet = new Planet();
    planet.mesh.position.set(1550, 2500, -6000); //1550,2550,3250
	scene.add(planet.mesh)

	sky.clouds.forEach(c =>{
		collidableMesh.push(c.mesh);
	})
}

function createSplosion(){

	splosion = new Mysterysplosion(camera.position.x,camera.position.y,camera.position.z);
	scene.add(splosion.particleSystem);
	console.log("particles ",splosion.particleSystem.x, splosion.particleSystem.y,splosion.particleSystem.z, camera.position.x,camera.position.y,camera.position.z);
	isSplosion = true;
}

function updateSplosion(){
	if (isSplosion){
		splosion.particleSystem.rotation.y += 0.01;
		splosion.particleSystem.z-=3.3*flyControls.speed;

	}
}

/* Yeah so this bit is horrible but cant help it right this moment */
var SpaceShip = function() {
	this.mesh = new THREE.Object3D();
	this.gltf;
	this.bullets = [];
	this.exhaust;
	//this.hitbox = new THREE.Box3();

	this.actiontimestamp;
	this.offsetx=0;
	this.offsety=0;
	this.hp=5;
	this.type;
	this.id="nobody";
	this.score=0;
	this.bulletMax=3;
	this.lines;
}

var spaceship;

function createShip(){
  spaceship = new SpaceShip(); 
  spaceship.type="hero";
  
  var loader = new GLTFLoader();
  loader.load( '../assets/models/nave_inimiga/scene.gltf', function (gltf2){
	  // get the vertices
	  spaceship.gltf=gltf2;
	  //console.log(gltf2);
	  spaceship.mesh=gltf2.scene.children[0];
	  spaceship.mesh.rotateY(3);
	  spaceship.mesh.rotateZ(2);

	  spaceship.exhaust = new THREE.Mesh(new THREE.CylinderGeometry(1,1,32,5,null,null,1), new THREE.MeshToonMaterial({
		color: Colors.pink,
		emissive: Colors.darkorange,
		emissiveIntensity: 0.5,
		transparent:true

	}));

	
	spaceship.exhaust.position.copy(spaceship.mesh.getWorldPosition()); // start position - the tip of the weapon
	spaceship.exhaust.position.z+=1.5;
	spaceship.exhaust.position.y+=15;
	spaceship.mesh.add(spaceship.exhaust);
	spaceship.mesh.userData={
		type: "hero"
	}; 
	spaceship.mesh.name="hero";
	
	  //var newMaterial = new THREE.MeshToonMaterial({color: Colors.darkkblue, emissive: Colors.darkkblue, wireframe:true});
	  spaceship.mesh.traverse((o) => {
		if (o.isMesh){o.material.emissive.setHex(Colors.pink); o.material.emissiveIntensity= 1;}

		
	  });

	  heroMesh.push(spaceship.mesh);
	  scene.add(spaceship.mesh);	
	  //spaceship.mesh.material.emissive.setHex(Colors.pink);
	 
	  
  }, undefined, function ( error ) {
  
	  console.error( error );
  
  } );

  

}

var audiomanager;

function createSound(){
	audiomanager = new LevelAudioManager();
	audiomanager.loadLevelAudio();
	
}
/**
 * Main Loop
 */

var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var shootingTarget;

function onDocumentMouseDown( event ) {

	//console.log("AHA!")

    event.preventDefault();

    mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1; 
	
	//Check if the pointer is pointing to a target by raycasting out

	raycaster.setFromCamera( mouse, camera );   

    var intersects = raycaster.intersectObjects( collidableMesh, true );
    if ( intersects.length > 0 ) {

		shootBullets(intersects[ 0 ].object, spaceship);
		//intersects[ 0 ].object.material.emissive.setHex(Colors.pink);

        //if(typeof intersects[ 0 ].object.material.emissive != "undefined" )  intersects[ 0 ].object.material.emissive.setHex(Colors.pink);

    } else{ 
		shootBullets(new THREE.Vector3(spaceship.mesh.position.x,spaceship.mesh.position.y,spaceship.mesh.position.z-3000), spaceship);
	}

}

var world = document.getElementById('world');
world.addEventListener( 'mousedown', onDocumentMouseDown, false );

var raycaster = new THREE.Raycaster();
var isbeat=true;
var isSplosion=false;
function loop(){
	// Level main loop 
	// Rotate the propeller, the sea and the sky
	//sky.mesh.rotation.z += .003;
	//shootBullets();
	if(state==-1){
		//END PHASE
		
		return;
	}


	var delta = clock.getDelta();
	

	flyControls.update(delta);
	
	//calculate next beat in timer


    // render the scene
	//updateSky(delta);
	updatePlanet();
	updateSplosion();
	
	updateBullets(delta);
	updatePlane();
	updateHud();



	checkProgression();

	if(state==3 && !isSplosion) createSplosion();
	if(state>=2){
		//console.log("PHASE 1");
		createEnemy();
		updateEnemy(delta);

		if(enemies.length==0) state+=1;
	}


	updateBeat(clock);
	
/* This is where the level logic needs to go 
*/

    composer.render(scene, camera);

	// call the loop function again
	requestAnimationFrame(loop);
}

var previoustime
function updateBeat(time){
	isbeat=false;
}

function beatTimer(){
	var timeout = 60000/audiomanager.bpm;
	//console.log(timeout,audiomanager.bpm)

	setInterval(function(){ 
		//console.log("BEAT");
		isbeat=true;
		beatCount+=1;
		updateSky();
	}, timeout);
}

function updateSky(){

   sky.moveWaves();
}

// HUD Updater for many happy times
function updateHud(){
	hud.updateSpeed(flyControls.speed);
	hud.updateHealth(spaceship.hp);
	hud.updateScore(spaceship.score);
	hud.updateGunAmmo();

}

function updatePlanet(){
	planet.mesh.position.z-=3.3*flyControls.speed;
}

var Bullet = function() {
	this.mesh =new THREE.Mesh(new THREE.CylinderGeometry(1,1,5,3,null,null,1), new THREE.MeshToonMaterial({
		color: Colors.pink,
		emissive: Colors.pink,
		emissiveIntensity:3,
		transparent: true,
		opacity:1

	}));
	//this.hitbox = new THREE.Box3();
	this.direction = new THREE.Vector3();
	this.mesh.userData = {type: "bullet"}
}

var bulletpitch=0;
//And this is the BULLET FACTORY
function shootBullets(target, shooter){
	//console.log(flyControls.bullets, flyControls.movementSpeed);
		//console.log(target);

		let bullet = new Bullet();

		bullet.mesh.position.copy(shooter.mesh.getWorldPosition()); // start position - the tip of the weapon
		bullet.mesh.rotation.copy(shooter.mesh.quaternion); // apply camera's quaternion
		//bullet.rotation.x+=Math.sin(spaceship.mesh.rotation.x);
		try {
			bullet.direction = target.getWorldPosition();
		} catch(err){
			bullet.direction =target;
		}

		//console.log(bullet.direction);
		
		scene.add(bullet.mesh);
		shooter.bullets.push(bullet);
		//console.log("shooting ",shooter.bullets.length)

		//Play PEW
		if(shooter.type=="hero"){
			//console.log(bulletpitch)
			audiomanager.shoot[bulletpitch].play();
			bulletpitch=Math.floor(Math.random()*audiomanager.shoot.length);
			
			//if(bulletpitch >= audiomanager.shoot.length) bulletpitch=0;

		}

		if(shooter.type=="enemy"){
			audiomanager.eshoot.play();
		}
	
}

function updateBullets(delta){
	var speed = 100;
	
	spaceship.bullets.forEach(b => {
		var group = new THREE.Group();
		//group.add(b.mesh);
		//console.log(b.mesh.position);
		var targetNormalizedVector = new THREE.Vector3(0,0,0);
		targetNormalizedVector.x = b.direction.x - b.mesh.position.x;
		targetNormalizedVector.y = b.direction.y - b.mesh.position.y;
		targetNormalizedVector.z = b.direction.z - b.mesh.position.z;
		targetNormalizedVector.normalize();
		b.mesh.translateOnAxis(targetNormalizedVector,speed);

		var bPos = new THREE.Vector3(b.mesh.position.x,b.mesh.position.y,b.mesh.position.z);
		var sPos = new THREE.Vector3(spaceship.mesh.position.x,spaceship.mesh.position.y,spaceship.mesh.position.z);
		if (bPos.distanceTo(sPos) >2000) cleanBullet(b);

		//finally lets check if it hit anything
		var originPoint = b.mesh.position.clone();
	
		for (var vertexIndex = 0; vertexIndex < b.mesh.geometry.vertices.length; vertexIndex++)
		{		
			var localVertex = b.mesh.geometry.vertices[vertexIndex].clone();
			var globalVertex = localVertex.applyMatrix4( b.mesh.matrix );
			var directionVector = globalVertex.sub( b.mesh.position );
			
			var ray = new THREE.Raycaster( originPoint, directionVector.clone().normalize() );
			var collisionResults = ray.intersectObjects( collidableMesh, true );

			if ( collisionResults.length > 0 && collisionResults[0].distance < directionVector.length() ) {
				var collidedObject = collisionResults[ 0 ].object;
				spaceship.score+=10;

				//console.log(" Hit ",collidedObject.userData.type);
				//audiomanager.sprites.play('drum1');
				if(collidedObject.userData.type=="hero" ){ 

					spaceship.health -=1;
					cleanBullet(b);
				}
				if(collidedObject.userData.type=="enemy" ){ 
					enemies.forEach(e =>{
						//console.log(e.id,collidedObject.userData);
						if(e.id==collidedObject.userData.id){
							audiomanager.ehit1.play();
							e.hp-=1;
							//console.log("E HEALTH ",e.hp);
							cleanBullet(b);
						}
					})
				}

				if(typeof collidedObject.material.emissive != "undefined" ){ 
					collidedObject.material.emissive.setHex(Colors.gray);
					cleanBullet(b);
				}
				

			}
				//cleanBullet(b);
		}	
		});

	
	speed = 0.000;
	
	enemies.forEach(e=>{
		e.bullets.forEach(b=>{
	/* 		var group = new THREE.Group();
			//group.add(b.mesh);
			//console.log(b.mesh.position);
			var targetNormalizedVector = new THREE.Vector3(0,0,0);
			targetNormalizedVector.x = b.direction.x - b.mesh.position.x;
			targetNormalizedVector.y = b.direction.y - b.mesh.position.y;
			targetNormalizedVector.z = b.direction.z - b.mesh.position.z;
			targetNormalizedVector.normalize();
			b.mesh.translateOnAxis(targetNormalizedVector,speed);
*/
			var bPos = new THREE.Vector3(b.mesh.position.x,b.mesh.position.y,b.mesh.position.z);
			var sPos = new THREE.Vector3(spaceship.mesh.position.x,spaceship.mesh.position.y,spaceship.mesh.position.z); 
			if (bPos.distanceTo(sPos) >1000) cleanBullet(b);

			//finally lets check if it hit anything
			var originPoint = b.mesh.position.clone();
		
			for (var vertexIndex = 0; vertexIndex < b.mesh.geometry.vertices.length; vertexIndex++)
			{		
				var localVertex = b.mesh.geometry.vertices[vertexIndex].clone();
				var globalVertex = localVertex.applyMatrix4( b.mesh.matrix );
				var directionVector = globalVertex.sub( b.mesh.position );
				
				var ray = new THREE.Raycaster( originPoint, directionVector.clone().normalize() );
				var collisionResults = ray.intersectObjects( heroMesh, true );

				if ( collisionResults.length > 0 && collisionResults[0].distance < directionVector.length() ) {
					var collidedObject = collisionResults[ 0 ].object;

					//console.log(" Hit player",collidedObject);
					//console.log("herohit");
					spaceship.hp -=1;
					//console.log("hero hp ", spaceship.hp);
					cleanBullet(b, "enemy");
						
					/* if(collidedObject.userData.type=="hero" ){ 
						console.log("herohit");
						spaceship.hp -=1;
						cleanBullet(b);
					} */
				}

			}	
		}) 
	}) //end of enemy bullets 

}

function cleanByUserDataID(id){

	scene.children.forEach(object =>{
		//console.log("new child ", id, object.userData.id)
		if (object.name == id){

			//console.log("found the bASTARD ",object);
			scene.remove(object);
			object.traverse( function ( child ) {

				if ( child.geometry !== undefined ) {
			
					child.geometry.dispose();
					child.material.dispose();
			
				}
			
			} );
			}

			//TODO: if enemy remove from enemylist
			//TODO if collidable remove from collidableList
			//console.log("cleanup complete ",scene);
		}
	)
}

function cleanBullet(b, shooter){
	//console.log("cleaning");
	b.mesh.traverse((o) => {
		if (o.isMesh){
			//console.log("found mesh - cleaning", o.userData.type)
			if(o.userData.type=="enemy") if(typeof o.gltf !== "undefined") cleanBullet(o.gltf.scene); //console.log(scene);
			o.geometry.dispose();
			o.material.dispose();
			scene.remove(o);
		}
		
	  });
	
	if (shooter == "enemy"){
		enemies.forEach(e=>{
			const index = e.bullets.indexOf(b);
			if (index > -1) {
				e.bullets.splice(index, 1);
			}
		})
		
	}else {
		const index = spaceship.bullets.indexOf(b);
		if (index > -1) {
			spaceship.bullets.splice(index, 1);
		}
	}
	renderer.renderLists.dispose();

}



function updatePlane(){
	//Load ship to update
	var shipmesh = spaceship.mesh;
	var exhaust = spaceship.exhaust;
	
	//position the ship with the camera
	shipmesh.position.copy(camera.position);
	shipmesh.rotation.copy(camera.rotation);
	shipmesh.quaternion.copy(camera.quaternion);
	shipmesh.position.z-=30;
	shipmesh.position.y-=10;
	shipmesh.rotateY(Math.PI);
	shipmesh.rotateX(Math.PI*1.5);

  	exhaust.material.opacity = 0 + flyControls.speed*0.1 ;//or any other value you like
}

function checkProgression(){
	var bPos = new THREE.Vector3(0.0,0);
	var sPos = new THREE.Vector3(spaceship.mesh.position.x,spaceship.mesh.position.y,spaceship.mesh.position.z);
		
	//console.log(bPos.distanceTo(sPos));
		if(spaceship.hp < 0) state = -1;

		if(state==1) if (bPos.distanceTo(sPos) >8000){ state+=1; }
		


}

function normalize(v,vmin,vmax,tmin, tmax){

	var nv = Math.max(Math.min(v,vmax), vmin);
	var dv = vmax-vmin;
	var pc = (nv-vmin)/dv;
	var dt = tmax-tmin;
	var tv = tmin + (pc*dt);
	return tv;

}

var enemies=[];
var enemycount=0;
var enemyUpperlimit=3;

function createEnemy(position, hp){
		if(enemycount < Enemy1[state] ){
		var enemy = new SpaceShip(); 
		enemy.type="enemy";
		enemy.score=1000;
		enemy.hp = 15;

		//console.log("enemy time");

			// get the vertices
			var objectId = Math.random().toString(36).substr(2, 9);	
			
			enemy.gltf="";
			//gltf2.scene.name="enemy_"+enemycount.toString();
			//console.log(gltf2);
			var geom = new THREE.IcosahedronGeometry(10,0)
			var material = new THREE.MeshStandardMaterial( {color: Colors.darkorange} );

			var edges = new THREE.EdgesGeometry(geom,0.1);
			enemy.lines = new THREE.LineSegments( edges, new THREE.LineDashedMaterial( { color: 0xffffff, emissive: Colors.darkorange,
				emissiveIntensity: 1.5, linewidth: 1,
				scale: 1,
				dashSize: 1,
				gapSize: 2, } ) );

			enemy.mesh = new THREE.Mesh( geom, material );    
			enemy.id=objectId.valueOf();

			enemy.mesh.traverse((o) => {
				enemy.mesh.userData ={
					type: "enemy", 
					id: objectId.valueOf()
				};
				if (o.isMesh) {
					o.userData ={
						type: "enemy", 
						id: objectId.valueOf()
					};

			  }});

			enemy.mesh.position.copy(spaceship.mesh.getWorldPosition());
			enemy.mesh.position.z-=400;
			enemy.mesh.position.y+=Math.random()*Math.PI+normalize(Math.random(),0,1,-1,1);
			enemy.mesh.position.x+=normalize(Math.random(),0,1,-120,200);

			enemy.mesh.name= objectId.valueOf();
				collidableMesh.push(enemy.mesh);
				enemies.push(enemy);
				
			scene.add(enemy.mesh);	
			scene.add(enemy.lines);

			
			//scene.add( line );
			//spaceship.mesh.material.emissive.setHex(Colors.pink);
		
			

		enemycount+=1;
	}
}

function degrees_to_radians(degrees)
{
  var pi = Math.PI;
  return degrees * (pi/180);
}

var t = 0;
function updateEnemy(delta){
	var enemytobeRemoved = [];

	//lets check each enemy
	enemies.forEach(e => {
		var angle = 100;
		var radius =100;
		var angleSpeed = 0.22;
		var radialSpeed = 0.5;

		//if this one is dead we remove it from the scene and stop updating it
		if (e.hp<0){
			//remove from enemies list
			enemytobeRemoved.push(e);
			return;
		}

		e.lines.position.z = e.mesh.position.z-=3.3*flyControls.speed;
		
		angle += delta * angleSpeed * normalize(Math.random(),0,1,-10,10);
   		radius -= delta * radialSpeed * normalize(Math.random(),0,1,-10,10);

		t += 0.002;          
	
		e.lines.position.y = e.mesh.position.y += e.offsety;
		e.lines.position.x = e.mesh.position.x += e.offsetx;
		e.lines.rotation.x = e.mesh.rotation.x += Math.floor(Math.random()*3)*0.01;
		
		/* if(isbeat == true){
			e.lines.rotation.x = e.mesh.rotation.x += Math.floor(Math.random()*2)*0.01;
			e.lines.rotation.z = e.mesh.rotation.z += Math.floor(Math.random()*2)*0.01;
	
		} */
		var bPos = new THREE.Vector3(e.mesh.position.x,e.mesh.position.y,e.mesh.position.z);
		var sPos = new THREE.Vector3(spaceship.mesh.position.x,spaceship.mesh.position.y,spaceship.mesh.position.z);

		if (bPos.distanceTo(sPos) < 500){
			//TODO> Something
			if(e.bullets.length<e.bulletMax && isbeat){
				shootBullets(spaceship,e);
			}

			if(isbeat){
				if(beatCount%2 ==0 ) e.bulletMax+=1;
			}
		if (bPos.distanceTo(sPos) < 3000){
			//cleanBullet(e);
		}
			//when the player gets near enough do something
		}

	})

	//console.log(enemytobeRemoved.length);
	//FINALLY CLEAN UP DEAD ENEMIES
	if(enemytobeRemoved.length>=1){
		enemytobeRemoved.forEach(e => {
			const index = enemies.indexOf(e);
			//give player score
			spaceship.score+=e.score;
			//console.log("le place in le ",index);
			if (index > -1) {
				enemies.splice(index, 1);
			}

			//clean from scene
			cleanByUserDataID(e.id);
			audiomanager.crash.play();
		});
	}

}