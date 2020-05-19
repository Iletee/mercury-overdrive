import * as THREE from '../node_modules/three/build/three.module.js'
import { FlyControls } from './FlyControls.js';
import { HeadsUpDisplay } from './HeadsUpDisplay.js';

import  * as Howler from '../node_modules/howler/dist/howler.js';
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
//import * as GameLoopControls from './controls.js';
import { UnrealBloomPass } from '../node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from '../node_modules/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../node_modules/three/examples/jsm/postprocessing/RenderPass.js';
//import { BloomPass } from './node_modules/three/examples/jsm/postprocessing/BloomPass.js';

var Colors = {
	darkkblue:0x0d0221,
	grayblue:0x261447,
	turqoise:0x2DE2E6,
	pink:0xFF3864,
    orange:0xFF6C11,
    lightorange:0xff9011,
    darkorange:0xc9550c,
	gray:0x241734,
};
var params = {
	exposure: 0.8,
	bloomStrength: 1.0,
	bloomThreshold: 0.7,
	bloomRadius: 0.45
};

window.addEventListener('load', init, false);

var clock;
var bpm=129;

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
    sound.once('load', function(){
			   
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
				sound.play();
				var music = document.getElementById("music");
				music.textwContent="Max McFerren - The Boy Got Skills";
				
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

	var bloomPass = new UnrealBloomPass(new THREE.Vector2( window.innerWidth, window.innerHeight ),1.5, 1, 0.85);
		bloomPass.threshold = params.bloomThreshold;
			bloomPass.strength = params.bloomStrength;
			bloomPass.radius = params.bloomRadius;
	renderer.setPixelRatio( window.devicePixelRatio );

				var renderScene = new RenderPass( scene, camera );
	composer = new EffectComposer( renderer );
	composer.addPass( renderScene );
	composer.addPass( bloomPass );
	
	// Listen to the screen: if the user resizes it
	// we have to update the camera and the renderer size
    //window.addEventListener('resize', handleWindowResize, false);
    
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
    flyControls.autoForward = false;
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
	shadowLight.position.set(150, 350, 350);
	
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

// First let's define a Sea object :
var Sea = function(){
	
	// create the geometry (shape) of the cylinder;
	// the parameters are: 
	// radius top, radius bottom, height, number of segments on the radius, number of segments vertically
	var geom = new THREE.CylinderGeometry(600,600,800,40,10);
	
	// rotate the geometry on the x axis
	geom.applyMatrix(new THREE.Matrix4().makeRotationX(-Math.PI/2));
	
	// create the material 
	var mat = new THREE.MeshPhongMaterial({
		color:Colors.turqoise,
		transparent:true,
		opacity:.6,
		shading:THREE.FlatShading,
	});

	// To create an object in Three.js, we have to create a mesh 
	// which is a combination of a geometry and some material
	this.mesh = new THREE.Mesh(geom, mat);

	// Allow the sea to receive shadows
	this.mesh.receiveShadow = true; 
}

// Instantiate the sea and add it to the scene:

var sea;

function createSea(){
	sea = new Sea();

	// push it a little bit at the bottom of the scene
	sea.mesh.position.y = -600;
    sea.mesh.rotateY(1.57)
	// add the mesh of the sea to the scene
	scene.add(sea.mesh);
}

var Planet = function(){
	this.mesh = new THREE.Object3D()
	var geom = new THREE.SphereGeometry(200,50,50);
	var material = new THREE.MeshToonMaterial( {color: Colors.darkkblue, emissive: Colors.darkkblue} );
	this.mesh = new THREE.Mesh( geom, material );
}


var Cloud = function(){
	// Create an empty container that will hold the different parts of the cloud
	this.mesh = new THREE.Object3D();
	
	// create a cube geometry;
	// this shape will be duplicated to create the cloud
	var geom = new THREE.BoxGeometry(20,20,20);
    geom.mergeVertices();
    // get the vertices
	var l = geom.vertices.length;

	// create an array to store new data associated to each vertex
	this.waves = [];

	for (var i=0; i<l; i++){
		// get each vertex
		var v = geom.vertices[i];

		// store some data associated to it
		this.waves.push({y:v.y,
										 x:v.x,
										 z:v.z,
										 // a random angle
										 ang:Math.random()*Math.PI*2,
										 // a random distance
										 amp:5 + Math.random()*15,
										 // a random speed between 0.016 and 0.048 radians / frame
										 speed:0.016 + Math.random()*0.032
										});
	};
	// create a material; a simple white material will do the trick
	var mat = new THREE.MeshToonMaterial({
        color:Colors.orange,
        emissive: Colors.orange,
        wireframe:false
    });
   
    
    
	// duplicate the geometry a random number of times
	var nBlocs = 3+Math.floor(Math.random()*3);
	for (var i=0; i<nBlocs; i++ ){
		
		// create the mesh by cloning the geometry
		var m = new THREE.Mesh(geom, mat); 
		
		// set the position and the rotation of each cube randomly
		m.position.x = i*15;
		m.position.y = Math.random()*10;
		m.position.z = Math.random()*10;
		m.rotation.z = Math.random()*Math.PI*2;
		m.rotation.y = Math.random()*Math.PI*2;
		
		// set the size of the cube randomly
		var s = .1 + Math.random()*.9;
		m.scale.set(s,s,s);
		
		// allow each cube to cast and to receive shadows
		m.castShadow = true;
		m.receiveShadow = true;
		
		// add the cube to the container we first created
		this.mesh.add(m);
    } 
}

    Cloud.prototype.moveWaves = function (){
        // get the vertices
        this.mesh["children"].forEach((element) => {
            var verts = element.geometry.vertices;
            var l = verts.length;
        
            for (var i=0; i<l; i++){
                var v = verts[i];
                
                // get the data associated to it
                var vprops = this.waves[i];
                
                // update the position of the vertex
                v.x = vprops.x + Math.sin(vprops.ang)*5;
                v.y = vprops.y + Math.cos(vprops.ang/2)*5;
        
                // increment the angle for the next frame
                vprops.ang += vprops.speed;
        
            }
        
            // Tell the renderer that the geometry of the sea has changed.
            // In fact, in order to maintain the best level of performance, 
            // three.js caches the geometries and ignores any changes
            // unless we add this line
            element.geometry.verticesNeedUpdate=true;
            
          })
        
    
    
}

var Sky = function(){
	// Create an empty container
	this.mesh = new THREE.Object3D();
	
	// choose a number of clouds to be scattered in the sky
	this.nClouds = 160;
	
	// To distribute the clouds consistently,
	// we need to place them according to a uniform angle
	var stepAngle = Math.PI*2 / this.nClouds;
    this.clouds=[];
    
	// create the clouds
	for(var i=0; i<this.nClouds; i++){
		var c = new Cloud();
	 
		// set the rotation and the position of each cloud;
		// for that we use a bit of trigonometry
		var a = stepAngle*i; // this is the final angle of the cloud
		var h = 750 + Math.random()*200; // this is the distance between the center of the axis and the cloud itself

		// Trigonometry!!! I hope you remember what you've learned in Math :)
		// in case you don't: 
		// we are simply converting polar coordinates (angle, distance) into Cartesian coordinates (x, y)
		c.mesh.position.y = Math.sin(a)*h;
		c.mesh.position.x = Math.cos(a)*h;

		// rotate the cloud according to its position
		//c.mesh.rotation.z = a + Math.PI/2;

		// for a better result, we position the clouds 
		// at random depths inside of the scene
		c.mesh.position.z = 200-Math.random()*800;
		
		// we also set a random scale for each cloud
		var s = 1+Math.random()*2;
        c.mesh.scale.set(s,s,s);
    

        this.clouds.push(c)
		// do not forget to add the mesh of each cloud in the scene
		this.mesh.add(c.mesh);  
	}  
	var planet = new Planet();
	this.mesh.add(planet.mesh)
}

Sky.prototype.moveWaves = function (){
    // get the vertices
    this.clouds.forEach((element) => {
        element.moveWaves();
      }
    )


}

// Now we instantiate the sky and push its center a bit
// towards the bottom of the screen

var sky;

function createSky(){
	sky = new Sky();
    sky.mesh.position.y = -600;
    sky.mesh.rotateY(1.57)
	scene.add(sky.mesh);
}

var AirPlane = function() {
	
	this.mesh = new THREE.Object3D();
	
	// Create the cabin
	var geomCockpit = new THREE.BoxGeometry(60,50,50,1,1,1);
	var matCockpit = new THREE.MeshPhongMaterial({color:Colors.pink, shading:THREE.FlatShading});
	var cockpit = new THREE.Mesh(geomCockpit, matCockpit);
	cockpit.castShadow = true;
	cockpit.receiveShadow = true;
	this.mesh.add(cockpit);
	
	// Create the engine
	var geomEngine = new THREE.BoxGeometry(20,50,50,1,1,1);
	var matEngine = new THREE.MeshPhongMaterial({color:Colors.orange, shading:THREE.FlatShading});
	var engine = new THREE.Mesh(geomEngine, matEngine);
	engine.position.x = 40;
	engine.castShadow = true;
	engine.receiveShadow = true;
	this.mesh.add(engine);
	
	// Create the tail
	var geomTailPlane = new THREE.BoxGeometry(15,20,5,1,1,1);
	var matTailPlane = new THREE.MeshPhongMaterial({color:Colors.pink, shading:THREE.FlatShading});
	var tailPlane = new THREE.Mesh(geomTailPlane, matTailPlane);
	tailPlane.position.set(-35,25,0);
	tailPlane.castShadow = true;
	tailPlane.receiveShadow = true;
	this.mesh.add(tailPlane);
	
	// Create the wing
	var geomSideWing = new THREE.BoxGeometry(40,8,150,1,1,1);
	var matSideWing = new THREE.MeshPhongMaterial({color:Colors.pink, shading:THREE.FlatShading});
	var sideWing = new THREE.Mesh(geomSideWing, matSideWing);
	sideWing.castShadow = true;
	sideWing.receiveShadow = true;
	this.mesh.add(sideWing);
	
	// propeller
	var geomPropeller = new THREE.BoxGeometry(20,10,10,1,1,1);
	var matPropeller = new THREE.MeshPhongMaterial({color:Colors.darkkblue, shading:THREE.FlatShading});
	this.propeller = new THREE.Mesh(geomPropeller, matPropeller);
	this.propeller.castShadow = true;
	this.propeller.receiveShadow = true;
	
	// blades
	var geomBlade = new THREE.BoxGeometry(1,100,20,1,1,1);
	var matBlade = new THREE.MeshPhongMaterial({color:Colors.gray, shading:THREE.FlatShading});
	
	var blade = new THREE.Mesh(geomBlade, matBlade);
	blade.position.set(8,0,0);
	blade.castShadow = true;
	blade.receiveShadow = true;
	this.propeller.add(blade);
	this.propeller.position.set(50,0,0);
	this.mesh.add(this.propeller);
};

var airplane;

function createPlane(){ 
	airplane = new AirPlane();
	airplane.mesh.scale.set(.25,.25,.25);
    //airplane.mesh.position.y = 100;
    //
	scene.add(airplane.mesh);
}


var SpaceShip = function() {
	this.mesh = new THREE.Object3D();
	this.gltf;
	this.bullets = [];
	this.exhaust;


}

var spaceship;

function createShip(){
  spaceship = new SpaceShip(); 
  
  var loader = new GLTFLoader();
  loader.load( '../assets/models/nave_inimiga/scene.gltf', function (gltf2){
	  // get the vertices
	  spaceship.gltf=gltf2;
	  console.log(gltf2);
	  spaceship.mesh=gltf2.scene.children[0];
	  spaceship.mesh.rotateY(3);
	  spaceship.mesh.rotateZ(2);

	  spaceship.exhaust = new THREE.Mesh(new THREE.CylinderGeometry(1,1,32,5,null,null,1), new THREE.MeshToonMaterial({
		color: Colors.pink,
		emissive: Colors.darkorange,
		emisiveIntensity: 0.5,
		transparent:true,

	}));

	
	spaceship.exhaust.position.copy(spaceship.mesh.getWorldPosition()); // start position - the tip of the weapon
	spaceship.exhaust.position.z+=1.5;
	spaceship.exhaust.position.y+=15;
	spaceship.mesh.add(spaceship.exhaust);
	  //var newMaterial = new THREE.MeshToonMaterial({color: Colors.darkkblue, emissive: Colors.darkkblue, wireframe:true});
	 /*  spaceship.mesh.traverse((o) => {
		if (o.isMesh) o.material = newMaterial;
	  });*/
	  scene.add(gltf2.scene);	
	 
	  
  }, undefined, function ( error ) {
  
	  console.error( error );
  
  } );
  //spaceship.mesh.rotation.order = "YXZ"; // 
 // camera.add(spaceship.mesh);
  //spaceship.mesh.position.set(0,0,-100);

}

var sound;

function createSound(){
    sound = new Howl({
        src: ['../assets/audio/The_Boy_Got_Skills.mp3']
      });
}

/**
 * Main Loop
 */

function loop(){
	// Rotate the propeller, the sea and the sky
	//airplane.propeller.rotation.x += 0.3;
	//sea.mesh.rotation.z += .01;
	sky.mesh.rotation.z += .003;
	shootBullets();

    var delta = clock.getDelta();

	//shipControls.update(delta);

	flyControls.update(delta);
   ;
    // render the scene
	updateSky(clock.getElapsedTime());
	updatePlane();
	
	updateBullets(delta);
	updatePlane();
	updateHud();

    composer.render(scene, camera);

	// call the loop function again
	requestAnimationFrame(loop);
}

var previoustime
function updateSky(time){
   var beats = time*100;
   beats = beats.toFixed(0)
   var divisor=6000/bpm/24;
   divisor = divisor.toFixed(0)
  // console.log(beats%46)
   //todo bpm manager
   if (beats%divisor==0) sky.moveWaves();
}

// HUD Updater for many happy times
function updateHud(){
	hud.updateSpeed(flyControls.speed);
}

//And this is the BULLET FACTORY
function shootBullets(){
	console.log(flyControls.bullets, flyControls.movementSpeed);
	if (flyControls.bullets==1){
		let bullet = new THREE.Mesh(new THREE.CylinderGeometry(1,1,5,3,null,null,1), new THREE.MeshToonMaterial({
			color: Colors.pink,
			emissive: Colors.pink,
			emissiveIntensity:3,
			transparent: true,
			opacity:1

		}));

		bullet.position.copy(spaceship.mesh.getWorldPosition()); // start position - the tip of the weapon
		bullet.rotation.copy(spaceship.mesh.quaternion); // apply camera's quaternion
		bullet.rotation.x+=Math.sin(spaceship.mesh.rotation.x);
		var mouseVector = new THREE.Vector3((GameLoopControls.MOUSEPOS.x)*-200, -GameLoopControls.MOUSEPOS.y*100,spaceship.mesh.position.z+(100));
		bullet.lookAt(mouseVector);
		
		scene.add(bullet);
		spaceship.bullets.push(bullet);

		//NO BULLETS TO SHOOT
		flyControls.bullets=0;
	}
}

function updateBullets(delta){
	var speed = 2400;
	spaceship.bullets.forEach(b => {
		b.translateZ(-speed *delta); // move along the local z-axis
		var bPos = new THREE.Vector3(b.position.x,b.position.y,b.position.z);
		var sPos = new THREE.Vector3(spaceship.mesh.position.x,spaceship.mesh.position.y,spaceship.mesh.position.z);
		if (bPos.distanceTo(sPos) >2000) cleanBullet(b);
	  });
}

function cleanBullet(b){
	
	scene.remove(b);
	const index = spaceship.bullets.indexOf(b);
	if (index > -1) {
		spaceship.bullets.splice(index, 1);
	}

}



function updatePlane(){
	//Load ship to update
	var shipmesh = spaceship.mesh;
	var exhaust = spaceship.exhaust;
	//console.log(exhaust);

	//var vec = new THREE.Vector3( 0, 0, -20 );
	//vec.applyQuaternion( camera.quaternion );
	
	//shipmesh.position.copy( vec );

	//quaternion.setFromUnitVectors(sPos, mouseVector);
	shipmesh.position.copy(camera.position);
	shipmesh.rotation.copy(camera.rotation);
	shipmesh.quaternion.copy(camera.quaternion);
	shipmesh.position.z-=30;
	shipmesh.position.y-=10;
	//shipmesh.rotateZ(1.3);
	shipmesh.rotateY(Math.PI);
	shipmesh.rotateX(Math.PI*1.5);
	//shipmesh.position.y-=5;

	
	//console.log(quaternion);
   //Rotate ship axes based on mouse with ceiling values
  // if (shipmesh.rotation.x > 0.8) shipmesh.rotation.x -= (GameLoopControls.MOUSEPOS.y / 250 ) *6; else shipmesh.rotation.x =0.81
  // if (shipmesh.rotation.x < 2.4) shipmesh.rotation.x -= (GameLoopControls.MOUSEPOS.y / 250 ) *6; else shipmesh.rotation.x =2.39


   ///rotating ship up and down
   //if (shipmesh.rotation.x > 0.8 && GameLoopControls.SPEED!=0) shipmesh.rotation.x += ((GameLoopControls.MOUSEPOS.y+0.2)/250 ) *6; else shipmesh.rotation.x =0.81
  // if (shipmesh.rotation.x < 2.3 && GameLoopControls.SPEED!=0) shipmesh.rotation.x += ((GameLoopControls.MOUSEPOS.y+0.2)/ 250 ) *6; else shipmesh.rotation.x =2.2

  
   //if (shipmesh.rotation.y >2 ) shipmesh.rotation.y += (GameLoopControls.MOUSEPOS.x / 250 ) *4; else shipmesh.rotation.y=2.01
   //if (shipmesh.rotation.y < 4) shipmesh.rotation.y += (GameLoopControls.MOUSEPOS.x / 250 ) *4; else shipmesh.rotation.y=3.99
   
   /* not needed for non flycontrolks

   if (shipmesh.rotation.y >2 ) shipmesh.rotation.y += (GameLoopControls.COUNTX / 250 ) *4; else shipmesh.rotation.y=2.01
   if (shipmesh.rotation.y < 4) shipmesh.rotation.y += (GameLoopControls.COUNTX / 250 ) *4; else shipmesh.rotation.y=3.99

  // if (shipmesh.rotation.x > 0.8) shipmesh.rotation.z += (GameLoopControls.COUNTX/ 250 ) *3; else shipmesh.rotation.x =0.81
  // if (shipmesh.rotation.x < 2.4) shipmesh.rotation.z += (GameLoopControls.COUNTX / 250 ) *3; else shipmesh.rotation.x =2.39

 
   controls.setRotationX(shipmesh.rotation.x);
   controls.setRotationY(shipmesh.rotation.y);



  // shipmesh.rotateY(GameLoopControls.COUNTY);
  // shipmesh.rotateZ(GameLoopControls.COUNTZ);
   //shipmesh.rotateX(GameLoopControls.COUNTX);

	//Move ship and camera based on speed vector - tweak numbers for
   shipmesh.position.x += GameLoopControls.SPEED*2*Math.sin(shipmesh.rotation.y);  //left right
   shipmesh.position.z -=GameLoopControls.SPEED*2*Math.cos(shipmesh.rotation.z); //forward
   shipmesh.position.y -=GameLoopControls.SPEED*1*Math.cos(shipmesh.rotation.x);
   camera.position.x += GameLoopControls.SPEED*2*Math.sin(shipmesh.rotation.y); 
   camera.position.z -=GameLoopControls.SPEED*2*Math.cos(shipmesh.rotation.z);
   camera.position.y -=GameLoopControls.SPEED*1*Math.cos(shipmesh.rotation.x);

   //camera.lookAt(spaceship);
*/
   //exhaust.materials[0].transparent = true;
   exhaust.material.opacity = 0 + flyControls.speed*0.1 ;//or any other value you like

   //GameLoopControls.COUNTX=0;
   //GameLoopControls.COUNTY=0;
}

function normalize(v,vmin,vmax,tmin, tmax){

	var nv = Math.max(Math.min(v,vmax), vmin);
	var dv = vmax-vmin;
	var pc = (nv-vmin)/dv;

}