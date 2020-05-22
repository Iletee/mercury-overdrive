import * as THREE from '../node_modules/three/build/three.module.js'
import { FlyControls } from './FlyControls.js';
import { HeadsUpDisplay } from './HeadsUpDisplay.js';
import { LevelAudioManager } from './audio.js';
import { Sky, Cloud, Planet } from './spaceprops.js';
import { Colors } from './store.js';

import  * as Howler from '../node_modules/howler/dist/howler.js';
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
//import * as GameLoopControls from './controls.js';
import { UnrealBloomPass } from '../node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from '../node_modules/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../node_modules/three/examples/jsm/postprocessing/RenderPass.js';
//import { BloomPass } from './node_modules/three/examples/jsm/postprocessing/BloomPass.js';

var collidableMesh=[];

var params = {
	exposure: 0.8,
	bloomStrength: 1.0,
	bloomThreshold: 0.7,
	bloomRadius: 0.45
};

window.addEventListener('load', init, false);

var clock;
var bpm=100;

var state="start";
var spacepressed=false;
var controls;

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

var sky;

function createSky(){
	sky = new Sky();
	sky.mesh.position.y = -600;
	sky.mesh.position.z = -6000;
    sky.mesh.rotateY(1.57)
	scene.add(sky.mesh);

	sky.clouds.forEach(c =>{
		collidableMesh.push(c.mesh);
	})
}

/* Yeah so this bit is horrible but cant help it right this moment */
var SpaceShip = function() {
	this.mesh = new THREE.Object3D();
	this.gltf;
	this.bullets = [];
	this.exhaust;
	this.hitbox = new THREE.Box3();

}

var spaceship;

function createShip(){
  spaceship = new SpaceShip(); 
  
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
		emisiveIntensity: 0.5,
		transparent:true

	}));

	
	spaceship.exhaust.position.copy(spaceship.mesh.getWorldPosition()); // start position - the tip of the weapon
	spaceship.exhaust.position.z+=1.5;
	spaceship.exhaust.position.y+=15;
	spaceship.mesh.add(spaceship.exhaust);
	
	  //var newMaterial = new THREE.MeshToonMaterial({color: Colors.darkkblue, emissive: Colors.darkkblue, wireframe:true});
	  spaceship.mesh.traverse((o) => {
		if (o.isMesh){o.material.emissive.setHex(Colors.pink); o.material.emissiveIntensity= 1;}

		
	  });
	  scene.add(gltf2.scene);	
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

    var intersects = raycaster.intersectObjects( scene.children, true );
    if ( intersects.length > 0 ) {

		shootBullets(intersects[ 0 ].object);

        //if(typeof intersects[ 0 ].object.material.emissive != "undefined" )  intersects[ 0 ].object.material.emissive.setHex(Colors.pink);

    } else{ 
		shootBullets(new THREE.Vector3(spaceship.mesh.position.x,spaceship.mesh.position.y,spaceship.mesh.position.z-3000));
	}

}

document.addEventListener( 'mousedown', onDocumentMouseDown, false );

var raycaster = new THREE.Raycaster();
function loop(){
	// Rotate the propeller, the sea and the sky
	//sky.mesh.rotation.z += .003;
	//shootBullets();

    var delta = clock.getDelta();

	flyControls.update(delta);
   
    // render the scene
	updateSky(delta);
	updatePlane();
	
	updateBullets(delta);
	updatePlane();
	updateHud();
	
/* This is where the level logic needs to go 
*/

    composer.render(scene, camera);

	// call the loop function again
	requestAnimationFrame(loop);
}

var previoustime
function updateSky(time){

   var beats = time*1000;
   var divisor=60/bpm*10;
   //console.log(beats,divisor);
  // console.log(beats%46)
   //todo bpm manager
   if (beats%divisor==0) sky.moveWaves();
}

// HUD Updater for many happy times
function updateHud(){
	hud.updateSpeed(flyControls.speed);
}


var Bullet = function() {
	this.mesh =new THREE.Mesh(new THREE.CylinderGeometry(1,1,5,3,null,null,1), new THREE.MeshToonMaterial({
		color: Colors.pink,
		emissive: Colors.pink,
		emissiveIntensity:3,
		transparent: true,
		opacity:1

	}));
	this.hitbox = new THREE.Box3();
	this.direction = new THREE.Vector3();
}

//And this is the BULLET FACTORY
function shootBullets(target){
	//console.log(flyControls.bullets, flyControls.movementSpeed);
		//console.log(target);

		let bullet = new Bullet();

		bullet.mesh.position.copy(spaceship.mesh.getWorldPosition()); // start position - the tip of the weapon
		bullet.mesh.rotation.copy(spaceship.mesh.quaternion); // apply camera's quaternion
		//bullet.rotation.x+=Math.sin(spaceship.mesh.rotation.x);
		try {
			bullet.direction = target.getWorldPosition();
		} catch(err){
			bullet.direction =target;
		}

		//console.log(bullet.direction);
		
		scene.add(bullet.mesh);
		spaceship.bullets.push(bullet);

		//Play PEW
		audiomanager.laser.play();
	
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
				console.log(" Hit ");
				if(typeof collisionResults[ 0 ].object.material.emissive != "undefined" ){ 
					collisionResults[ 0 ].object.material.emissive.setHex(Colors.gray);
					cleanBullet(b);

					var deadObject = function(){this.mesh;};
					deadObject.mesh=collisionResults[ 0 ].object;
					cleanBullet(deadObject);
				}
			}
				//cleanBullet(b);

		}	
		});

		// this is where enemy bullets should move and test

}

function cleanBullet(b){
	//console.log("cleaning");
	
	b.mesh.geometry.dispose();
	b.mesh.material.dispose();
	scene.remove(b.mesh);

	const index = spaceship.bullets.indexOf(b);
	if (index > -1) {
		spaceship.bullets.splice(index, 1);
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

function normalize(v,vmin,vmax,tmin, tmax){

	var nv = Math.max(Math.min(v,vmax), vmin);
	var dv = vmax-vmin;
	var pc = (nv-vmin)/dv;

}