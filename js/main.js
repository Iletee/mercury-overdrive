import * as THREE from '../node_modules/three/build/three.module.js'
import { FlyControls } from '../node_modules/three/examples/jsm/controls/FlyControls.js';
import  * as Howler from '../node_modules/howler/dist/howler.js';

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

window.addEventListener('load', init, false);

var clock;

function init() {
    // set up the scene, the camera and the renderer
    clock = new THREE.Clock();
	createScene();

	// add the lights
	createLights();

	// add the objects
	createPlane();
	//createSea();
    createSky();
    
    //add the listener
    createControls();
    document.addEventListener('mousemove', handleMouseMove, false);
    document.addEventListener('onkeydown', handleKeyDown);
    // Play music
    sound.once('load', function(){
        //sound.play();
        loop();
      });
	// start a loop that will update the objects' positions 
	// and render the scene on each frame
    
    
}

var scene,
		camera, fieldOfView, aspectRatio, nearPlane, farPlane, HEIGHT, WIDTH,
		renderer, container;

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
	camera = new THREE.PerspectiveCamera(
		fieldOfView,
		aspectRatio,
		nearPlane,
		farPlane
		);
	
	// Set the position of the camera
	camera.position.x = -100;
	camera.position.z = 300;
	camera.position.y = 200;
	
	// Create the renderer
	renderer = new THREE.WebGLRenderer({ 
		// Allow transparency to show the gradient background
		// we defined in the CSS
		alpha: true, 

		// Activate the anti-aliasing; this is less performant,
		// but, as our project is low-poly based, it should be fine :)
		antialias: true 
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
	
	// Listen to the screen: if the user resizes it
	// we have to update the camera and the renderer size
    //window.addEventListener('resize', handleWindowResize, false);
    
    createSound();
}



var flyControls;

function createControls(){

    flyControls = new FlyControls(camera, container);

    flyControls.movementSpeed = 200;
    flyControls.domElement = container;
    flyControls.rollSpeed = Math.PI / 20;
    flyControls.autoForward = false;
    flyControls.dragToLook = false;

    

}

function handleKeyDown(event){
    console.log("keypress");

}

var hemisphereLight, shadowLight;

function createLights() {
	// A hemisphere light is a gradient colored light; 
	// the first parameter is the sky color, the second parameter is the ground color, 
	// the third parameter is the intensity of the light
	hemisphereLight = new THREE.HemisphereLight(Colors.darkkblue,Colors.grayblue, .9)
	
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
	var mat = new THREE.MeshBasicMaterial({
        color:Colors.orange,
        wireframe:true
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
                v.x = vprops.x + Math.cos(vprops.ang/2);
                v.y = vprops.y + Math.sin(vprops.ang/2);
        
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
	this.nClouds = 20;
	
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
		c.mesh.rotation.z = a + Math.PI/2;

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
}

Sky.prototype.moveWaves = function (){
    console.log(this.nClouds)
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
	airplane.propeller.rotation.x += 0.3;
	//sea.mesh.rotation.z += .01;
    //sky.mesh.rotation.z += .003;

    var delta = clock.getDelta();

    flyControls.update(delta);
    //sky.mesh.updateWaves();
    // render the scene
    updateSky(clock.getElapsedTime());

    renderer.render(scene, camera);

	// call the loop function again
	requestAnimationFrame(loop);
}

function updateSky(time){
    //console.log(time.toFixed(2));
   sky.moveWaves();
}

var mousePos={x:0, y:0};

// now handle the mousemove event

function handleMouseMove(event) {

	// here we are converting the mouse position value received 
	// to a normalized value varying between -1 and 1;
	// this is the formula for the horizontal axis:
	
	var tx = -1 + (event.clientX / WIDTH)*2;

	// for the vertical axis, we need to inverse the formula 
	// because the 2D y-axis goes the opposite direction of the 3D y-axis
	
	var ty = 1 - (event.clientY / HEIGHT)*2;
	mousePos = {x:tx, y:ty};

}

function updatePlane(){

	// let's move the airplane between -100 and 100 on the horizontal axis, 
	// and between 25 and 175 on the vertical axis,
	// depending on the mouse position which ranges between -1 and 1 on both axes;
	// to achieve that we use a normalize function (see below)
	
	var targetX = normalize(mousePos.x, -1, 1, -400, 200);
	var targetY = normalize(mousePos.y, -1, 1, 25, 325);

	// update the airplane's position
	//airplane.mesh.position.y = targetY;
    //airplane.mesh.position.x = targetX;

    	// update the airplane's position
	airplane.mesh.position.copy(camera.position);
    airplane.mesh.rotation.copy(camera.rotation);
    airplane.mesh.rotateY(0.4);
    airplane.mesh.translateZ( - 200 );
    airplane.mesh.translateX(20);
    airplane.mesh.rotation.y=1;
    airplane.mesh.updateMatrix();
    //console.log("position %f ",airplane.mesh.rotation.y)
    
    //limit 
    //airplane.mesh.rotation.x=normalize(mousePos.x,-1,1,-0.2,0.2); 
    //airplane.mesh.rotation.z=normalize(mousePos.x,-1,1,-0.5,0.5);

    airplane.propeller.rotation.x += 0.3;
}

function normalize(v,vmin,vmax,tmin, tmax){

	var nv = Math.max(Math.min(v,vmax), vmin);
	var dv = vmax-vmin;
	var pc = (nv-vmin)/dv;
	var dt = tmax-tmin;
	var tv = tmin + (pc*dt);
	return tv;

}