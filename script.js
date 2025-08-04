
const video = document.getElementById('camera-feed');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');



// --- Global Variables ---
let detector = null;
let lastHandDetectionTime = 0;
const HAND_PERSISTENCE_MS = 150;
const SMOOTHING_FACTOR = 0.5; // Set to 1.0 to remove interpolation

// --- Gesture Detection Thresholds ---
const PINCH_THRESHOLD = 30; // Max distance between thumb and index tip for a pinch

// --- Game & Physics Objects ---
const engine = {
    gravity: 0.6,
    friction: 0.98,
    bounce: 0.7,
    airResistance: 0.999
};
const RELEASE_MULTIPLIER = 0.2; // Adjusted to limit release speed
const balls = [];
const ballRadius = 30;
const MAX_BALLS = 10; // Reduced for better performance

function createHand(color) {
    return {
        x: 0, y: 0, radius: 70,
        color: color,
        visible: false,
        dx: 0, dy: 0,
        isPinching: false,
        heldBall: null,
        releaseCounter: 0,
        velocityHistory: [],
        thumbPos: { x: 0, y: 0 },
        indexPos: { x: 0, y: 0 },
        lastDetectionTime: 0
    };
}

const leftHand = createHand('rgba(0, 0, 255, 0.5)'); // Blue for left
const rightHand = createHand('rgba(0, 255, 0, 0.5)'); // Green for right

const hoop = {
    x: 50, // Position on the left
    y: 0, // Will be set dynamically in main
    width: 200, // Overall hoop width (backboard)
    rimRadiusX: 70, // Horizontal radius of the oval rim
    rimRadiusY: 10, // Vertical radius (thickness) of the oval rim
    rimPostRadius: 10, // Radius of the invisible physics spheres for the rim
    backboardHeight: 150,
    rimColor: 'orange',
    backboardColor: '#8B4513', // SaddleBrown
    rimPostLeft: { x: 0, y: 0, radius: 10 },
    rimPostRight: { x: 0, y: 0, radius: 10 }
};

const hoopRight = {
    x: 0, // Position on the right, will be set dynamically
    y: 0, // Will be set dynamically in main
    width: 200,
    rimRadiusX: 70,
    rimRadiusY: 10,
    rimPostRadius: 10,
    backboardHeight: 150,
    rimColor: 'orange',
    backboardColor: '#8B4513',
    rimPostLeft: { x: 0, y: 0, radius: 10 },
    rimPostRight: { x: 0, y: 0, radius: 10 }
};

let score = 0;
let basketballImage = new Image();
basketballImage.src = 'ball.png'; // Changed to your local image file
let hoopImage = new Image();
hoopImage.src = 'hoop.png';

let isDragging = false;
let draggedHoop = null;
let draggedPost = null;

let leftScore = 0;
let rightScore = 0;
let leftFlashEndTime = 0;
let rightFlashEndTime = 0;
const FLASH_DURATION = 500; // ms

const saveButton = {
    x: 50,
    y: 50,
    width: 200,
    height: 50,
    text: 'Save Coordinates',
    color: 'blue',
    textColor: 'white'
};

let frameTimes = []; // For FPS calculation
const FPS_HISTORY = 10; // Average over last 10 frames

// --- Main Setup Function ---
async function main() {
    try {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        await setupCamera(); // Ensure camera is set up first

        // Request full screen
        const elem = document.documentElement;
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.mozRequestFullScreen) { // Firefox
            elem.mozRequestFullScreen();
        } else if (elem.webkitRequestFullscreen) { // Chrome, Safari, Opera
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) { // IE/Edge
            elem.msRequestFullscreen();
        }

        // Set hoop positions - flush with edges
        const hoopY = 650; // Lower position
        
        hoop.y = hoopY;
        hoop.x = 0; // Flush with left edge
        hoopRight.y = hoopY;
        hoopRight.x = canvas.width - hoopRight.width; // Flush with right edge

        // Initialize rim post positions - symmetrical positioning
        const leftHoopCenterX = hoop.width / 2;
        const leftHoopCenterY = hoopY;
        const rimSpacing = 188 - 54; // Distance between rim posts
        const rimYOffset = 516 - hoopY; // Y offset from hoop center
        
        // Left hoop rim posts - positioned symmetrically
        hoop.rimPostLeft.x = leftHoopCenterX - rimSpacing / 2;
        hoop.rimPostLeft.y = leftHoopCenterY + rimYOffset;
        hoop.rimPostRight.x = leftHoopCenterX + rimSpacing / 2;
        hoop.rimPostRight.y = leftHoopCenterY + rimYOffset;

        // For right hoop, position rim posts correctly for non-flipped hoop
        const rightHoopCenterX = canvas.width - hoopRight.width / 2;
        const rightHoopCenterY = hoopY;
        const leftRimSpacing = 188 - 54; // Distance between left rim posts
        const leftRimYOffset = 516 - hoopY; // Y offset from hoop center
        
        // Right hoop rim posts - positioned to match the hoop image
        hoopRight.rimPostLeft.x = rightHoopCenterX - leftRimSpacing / 2;
        hoopRight.rimPostLeft.y = rightHoopCenterY + leftRimYOffset;
        hoopRight.rimPostRight.x = rightHoopCenterX + leftRimSpacing / 2;
        hoopRight.rimPostRight.y = rightHoopCenterY + leftRimYOffset;

        // Load images without blocking the game start
        hoopImage.onload = () => console.log("Hoop image loaded");
        hoopImage.onerror = () => console.warn("Failed to load hoop.png. Hoops will be drawn procedurally.");
        
        basketballImage.onload = () => console.log("Basketball image loaded");
        basketballImage.onerror = () => console.warn("Failed to load ball.png. Balls will be drawn as circles.");

        await loadHandTrackingModel();

        // Create initial set of balls
        for (let i = 0; i < MAX_BALLS; i++) {
            createBall();
        }

        let previousTime = performance.now();
        const FPS = 60;
        const frameDuration = 1000 / FPS;
        let accumulator = 0;

        let frameCount = 0; // For skipping detection

        async function gameLoop(currentTime) {
            requestAnimationFrame(gameLoop);

            const deltaTime = currentTime - previousTime;
            previousTime = currentTime;
            accumulator += deltaTime;

            // Update FPS
            if (deltaTime > 0) {
                const fps = 1000 / deltaTime;
                frameTimes.push(fps);
                if (frameTimes.length > FPS_HISTORY) {
                    frameTimes.shift();
                }
            }

            let predictions = [];
            frameCount++;
            if (detector && video.readyState >= 2) {
                predictions = await detector.estimateHands(video);
            }

            updateHandState(predictions);

            while (accumulator >= frameDuration) {
                updateBalls();
                checkHandCollisions();
                checkRimCollisions(); // New collision check for the rim
                checkBallCollisions(); // Ensure ball-to-ball collisions are checked
                checkScore();
                accumulator -= frameDuration;
            }

            draw();
        }

        gameLoop(performance.now());
    } catch (error) {
        console.error("Setup failed:", error);
        ctx.fillStyle = 'white';
        ctx.font = '20px Arial';
        ctx.fillText(`ERROR: ${error.message}`, 20, 50);
    }
}

// --- Initialization ---
async function setupCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support camera access. Please use a modern browser like Chrome, Firefox, Safari, or Edge.');
        throw new Error('Browser does not support getUserMedia');
    }

    try {
        console.log("Attempting to get camera stream...");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = stream;
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                console.log("Video metadata loaded. Video playing.");
                console.log(`Video dimensions: ${video.videoWidth}x${video.videoHeight}`);
                resolve(video);
            };
            video.onerror = (e) => {
                console.error("Video element error:", e);
                throw new Error("Video element failed to load.");
            };
        });
    } catch (error) {
        console.error("Error accessing camera:", error);
        if (error.name === 'NotAllowedError') {
            alert("Camera access was denied. Please grant permission to use the camera in your browser settings and refresh the page.");
        } else if (error.name === 'NotFoundError') {
            alert("No camera found. Please ensure a camera is connected and enabled, then refresh the page.");
        } else {
            alert(`Failed to access camera: ${error.message}. Please check your browser compatibility and permissions.`);
        }
        throw error; // Re-throw to stop further execution if camera fails
    }
}

async function loadHandTrackingModel() {
    if (typeof handPoseDetection === 'undefined') {
        throw new Error("handPoseDetection library not loaded. Check script order in index.html.");
    }
    const model = handPoseDetection.SupportedModels.MediaPipeHands;
    const detectorConfig = { runtime: 'mediapipe', solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240', maxNumHands: 2 };
    detector = await handPoseDetection.createDetector(model, detectorConfig);
}

// --- Main Game Loop ---
async function gameLoop(currentTime) {
    requestAnimationFrame(gameLoop);

    const deltaTime = currentTime - previousTime;
    previousTime = currentTime;
    accumulator += deltaTime;

    let predictions = [];
    if (detector && video.readyState >= 2) {
        predictions = await detector.estimateHands(video);
    }

    updateHandState(predictions);

    while (accumulator >= frameDuration) {
        updateBalls();
        checkHandCollisions();
        checkRimCollisions(); // New collision check for the rim
        checkBallCollisions(); // Ensure ball-to-ball collisions are checked
        checkScore();
        accumulator -= frameDuration;
    }

    draw();
}

// --- Update Functions ---
function updateHandState(predictions) {
    const now = Date.now();
    let leftDetected = false;
    let rightDetected = false;

    for (const prediction of predictions) {
        const keypoints = prediction.keypoints;

        // Correct for 'object-fit: cover' by calculating scale and offset
        const videoRatio = video.videoWidth / video.videoHeight;
        const canvasRatio = canvas.width / canvas.height;
        let scale = 1;
        let offsetX = 0;
        let offsetY = 0;

        if (videoRatio > canvasRatio) { // Video wider than canvas, cropped horizontally
            scale = canvas.height / video.videoHeight;
            offsetX = (canvas.width - video.videoWidth * scale) / 2;
        } else { // Video taller than canvas, cropped vertically
            scale = canvas.width / video.videoWidth;
            offsetY = (canvas.height - video.videoHeight * scale) / 2;
        }

        const mapToCanvas = (point) => {
            const x = (point.x * scale) + offsetX;
            const y = (point.y * scale) + offsetY;
            // Flip x-axis because of the 'transform: scaleX(-1)' CSS
            return { x: canvas.width - x, y: y };
        };

        const thumbTip = keypoints[4];
        const indexTip = keypoints[8];
        if (thumbTip && indexTip) {
            const dist = Math.sqrt(Math.pow(thumbTip.x - indexTip.x, 2) + Math.pow(thumbTip.y - indexTip.y, 2));

            const midPoint = { x: (thumbTip.x + indexTip.x) / 2, y: (thumbTip.y + indexTip.y) / 2 };
            const mappedMidPoint = mapToCanvas(midPoint);
            const targetX = mappedMidPoint.x;
            const targetY = mappedMidPoint.y;

            // Determine which hand based on position
            const handObj = (targetX < canvas.width / 2) ? leftHand : rightHand;
            handObj.lastDetectionTime = now;
            handObj.isPinching = dist < PINCH_THRESHOLD;

            const mappedThumb = mapToCanvas(thumbTip);
            handObj.thumbPos.x = mappedThumb.x;
            handObj.thumbPos.y = mappedThumb.y;

            const mappedIndex = mapToCanvas(indexTip);
            handObj.indexPos.x = mappedIndex.x;
            handObj.indexPos.y = mappedIndex.y;

            if (!isNaN(targetX) && !isNaN(targetY)) {
                handObj.visible = true;
                
                handObj.dx = targetX - handObj.x;
                handObj.dy = targetY - handObj.y;

                handObj.velocityHistory.push({ dx: handObj.dx, dy: handObj.dy });
                if (handObj.velocityHistory.length > 3) {
                    handObj.velocityHistory.shift();
                }

                handObj.x += (targetX - handObj.x) * SMOOTHING_FACTOR;
                handObj.y += (targetY - handObj.y) * SMOOTHING_FACTOR;

            } else {
                handObj.visible = false;
            }

            if (targetX < canvas.width / 2) leftDetected = true;
            else rightDetected = true;
        }
    }

    // Handle persistence for undetected hands
    if (!leftDetected) {
        leftHand.isPinching = false;
        if (now - leftHand.lastDetectionTime < HAND_PERSISTENCE_MS) {
            leftHand.visible = true;
            leftHand.x += leftHand.dx * 0.5;
            leftHand.y += leftHand.dy * 0.5;
        } else {
            leftHand.visible = false;
            leftHand.dx = 0;
            leftHand.dy = 0;
        }
    }

    if (!rightDetected) {
        rightHand.isPinching = false;
        if (now - rightHand.lastDetectionTime < HAND_PERSISTENCE_MS) {
            rightHand.visible = true;
            rightHand.x += rightHand.dx * 0.5;
            rightHand.y += rightHand.dy * 0.5;
        } else {
            rightHand.visible = false;
            rightHand.dx = 0;
            rightHand.dy = 0;
        }
    }
}

function updateBalls() {
    for (let i = balls.length - 1; i >= 0; i--) {
        const ball = balls[i];

        if (ball.isCaught && ball.heldBy) {
            const handObj = ball.heldBy;
            ball.x = handObj.x;
            ball.y = handObj.y;
            ball.dx = handObj.dx;
            ball.dy = handObj.dy;
            ball.angularVelocity = 0; // No spin while held

            if (!handObj.isPinching) {
                handObj.releaseCounter++;
                if (handObj.releaseCounter >= 3) { // Adjusted for quicker release
                    ball.isCaught = false;
                    handObj.heldBall = null;
                    ball.heldBy = null;
                    handObj.releaseCounter = 0;

                    // Calculate average velocity
                    const avgVelocity = handObj.velocityHistory.reduce((acc, v) => {
                        acc.dx += v.dx;
                        acc.dy += v.dy;
                        return acc;
                    }, { dx: 0, dy: 0 });

                    avgVelocity.dx /= handObj.velocityHistory.length;
                    avgVelocity.dy /= handObj.velocityHistory.length;

                    ball.dx = avgVelocity.dx * RELEASE_MULTIPLIER;
                    ball.dy = avgVelocity.dy * RELEASE_MULTIPLIER;
                    ball.angularVelocity = -avgVelocity.dx / ball.radius * 0.5; // Impart spin based on horizontal velocity
                    ball.ignoreHandCollisionUntil = Date.now() + 500;
                }
            } else {
                handObj.releaseCounter = 0; // Reset counter if pinching again
            }
        } else {
            // Apply gravity
            ball.dy += engine.gravity;
            
            // Apply air resistance
            ball.dx *= engine.airResistance;
            ball.dy *= engine.airResistance;
            ball.angularVelocity *= engine.airResistance; // Air resistance on spin
            
            // Update position and rotation
            ball.x += ball.dx;
            ball.y += ball.dy;
            ball.rotation += ball.angularVelocity;

            // Clamp ball position to be within the canvas boundaries
            if (ball.x + ball.radius > canvas.width) {
                ball.x = canvas.width - ball.radius;
                ball.dx *= -engine.bounce;
            } else if (ball.x - ball.radius < 0) {
                ball.x = ball.radius;
                ball.dx *= -engine.bounce;
            }
            if (ball.y + ball.radius > canvas.height) {
                ball.y = canvas.height - ball.radius;
                ball.dy *= -engine.bounce;
                ball.dx *= engine.friction; // Apply friction when hitting the floor
                ball.angularVelocity = -ball.dx / ball.radius; // Spin based on horizontal velocity on bounce
                if (ball.scored) {
                    ball.scored = false; // Reset for next score
                }
            } else if (ball.y - ball.radius < 0) {
                ball.y = ball.radius;
                ball.dy *= -engine.bounce;
            }
        }
    }
}

function checkHandCollisions() {
    checkSingleHandCollisions(leftHand);
    checkSingleHandCollisions(rightHand);
}

function checkSingleHandCollisions(handObj) {
    if (!handObj.visible) return;

    for (const ball of balls) {
        if (ball.isCaught) continue;
        if (ball.ignoreHandCollisionUntil && Date.now() < ball.ignoreHandCollisionUntil) {
            continue; // Skip collision if ignoring hand physics
        }

        const dx = ball.x - handObj.x;
        const dy = ball.y - handObj.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = ball.radius + handObj.radius;

        if (distance < minDistance) {
            if (handObj.isPinching && !handObj.heldBall) { // Can only grab if not already holding a ball
                ball.isCaught = true;
                handObj.heldBall = ball;
                ball.heldBy = handObj; // Link ball to hand
            }
        }
    }
}

function checkRimCollisions() {
    checkSingleHoopRimCollision(hoop);
    checkSingleHoopRimCollision(hoopRight);
}

function checkSingleHoopRimCollision(hoopObj) {
    for (const ball of balls) {
        if (ball.isCaught) continue;

        // Collision with left rim post
        let dx = ball.x - hoopObj.rimPostLeft.x;
        let dy = ball.y - hoopObj.rimPostLeft.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        let minDistance = ball.radius + hoopObj.rimPostLeft.radius;

        if (distance < minDistance) {
            const normalX = dx / distance;
            const normalY = dy / distance;
            const overlap = minDistance - distance;
            
            // Separate ball from rim post
            ball.x += normalX * overlap;
            ball.y += normalY * overlap;
            
            // Reflect velocity with bounce
            const dotProduct = ball.dx * normalX + ball.dy * normalY;
            ball.dx -= 2 * dotProduct * normalX;
            ball.dy -= 2 * dotProduct * normalY;
            
            // Apply bounce factor
            ball.dx *= engine.bounce;
            ball.dy *= engine.bounce;
        }

        // Collision with right rim post
        dx = ball.x - hoopObj.rimPostRight.x;
        dy = ball.y - hoopObj.rimPostRight.y;
        distance = Math.sqrt(dx * dx + dy * dy);
        minDistance = ball.radius + hoopObj.rimPostRight.radius;

        if (distance < minDistance) {
            const normalX = dx / distance;
            const normalY = dy / distance;
            const overlap = minDistance - distance;
            
            // Separate ball from rim post
            ball.x += normalX * overlap;
            ball.y += normalY * overlap;
            
            // Reflect velocity with bounce
            const dotProduct = ball.dx * normalX + ball.dy * normalY;
            ball.dx -= 2 * dotProduct * normalX;
            ball.dy -= 2 * dotProduct * normalY;
            
            // Apply bounce factor
            ball.dx *= engine.bounce;
            ball.dy *= engine.bounce;
        }
    }
}

function checkScore() {
    checkSingleHoopScore(hoop, 'left'); // Left hoop scores for right player
    checkSingleHoopScore(hoopRight, 'right'); // Right hoop scores for left player
}

function checkSingleHoopScore(hoopObj, side) {
    for (const ball of balls) {
        if (ball.isCaught || ball.scored) continue;

        const rimCenterX = hoopObj.x + hoopObj.width / 2;
        const rimTopY = hoopObj.y;
        const rimBottomY = hoopObj.y + hoopObj.rimRadiusY; // Bottom of the oval rim

        // Check if ball is within the horizontal bounds of the rim
        const isWithinRimX = ball.x > (rimCenterX - hoopObj.rimRadiusX) && ball.x < (rimCenterX + hoopObj.rimRadiusX);

        // Check if ball is passing through the rim vertically
        // Ball must be above the rim and then pass below it, moving downwards
        const isPassingThroughRimVertically = ball.y - ball.radius < rimTopY && ball.y + ball.radius > rimBottomY;

        const isMovingDown = ball.dy > 0;

        if (isWithinRimX && isPassingThroughRimVertically && isMovingDown) {
            ball.scored = true;
            ball.dy *= 0.5; // Slow down vertical velocity
            ball.dx *= 0.5; // Slow down horizontal velocity
            console.log("Score! Current Score: left=", leftScore, " right=", rightScore);

            if (side === 'left') {
                rightScore++;
                rightFlashEndTime = Date.now() + FLASH_DURATION;
            } else if (side === 'right') {
                leftScore++;
                leftFlashEndTime = Date.now() + FLASH_DURATION;
            }
        }
    }
}

function createBall() {
    balls.push({
        x: Math.random() * canvas.width,
        y: -ballRadius,
        radius: ballRadius,
        dx: Math.random() * 8 - 4,
        dy: 0,
        rotation: 0,
        angularVelocity: Math.random() * 0.1 - 0.05, // Initial random spin
        isCaught: false,
        scored: false,
        mass: 1, // Add mass property for physics calculations
        heldBy: null
    });
}

function checkBallCollisions() {
    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const ballA = balls[i];
            const ballB = balls[j];

            const dx = ballB.x - ballA.x;
            const dy = ballB.y - ballA.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = ballA.radius + ballB.radius;

            if (distance < minDistance) {
                // Separate the balls to prevent sticking
                const normalX = dx / distance;
                const normalY = dy / distance;
                const overlap = minDistance - distance;
                const correctionX = normalX * overlap / 2;
                const correctionY = normalY * overlap / 2;

                ballA.x -= correctionX;
                ballA.y -= correctionY;
                ballB.x += correctionX;
                ballB.y += correctionY;

                // Calculate relative velocity
                const relativeVx = ballB.dx - ballA.dx;
                const relativeVy = ballB.dy - ballA.dy;

                // Calculate velocity along the normal
                const velocityAlongNormal = relativeVx * normalX + relativeVy * normalY;

                // Only resolve if balls are moving towards each other
                if (velocityAlongNormal < 0) {
                    // Calculate impulse scalar
                    const impulseScalar = -(1 + engine.bounce) * velocityAlongNormal / (ballA.mass + ballB.mass);

                    // Apply impulse
                    ballA.dx -= impulseScalar * ballB.mass * normalX;
                    ballA.dy -= impulseScalar * ballB.mass * normalY;
                    ballB.dx += impulseScalar * ballA.mass * normalX;
                    ballB.dy += impulseScalar * ballA.mass * normalY;
                }
            }
        }
    }
}

// --- Draw Functions ---
function draw() {
    // Optimized clear: Only clear dynamic areas (e.g., above floor)
    ctx.clearRect(0, 0, canvas.width, canvas.height - 30);
    drawFloor();

    // Draw balls
    for (const ball of balls) {
        if (basketballImage.complete && basketballImage.naturalHeight !== 0) {
            // Draw image if loaded with rotation
            ctx.save();
            ctx.translate(ball.x, ball.y);
            ctx.rotate(ball.rotation);
            ctx.drawImage(basketballImage, -ball.radius, -ball.radius, ball.radius * 2, ball.radius * 2);
            ctx.restore();
        } else {
            // Fallback to drawing a circle if image not loaded (no rotation for fallback)
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
            ctx.fillStyle = '#FF8C00'; // Dark Orange for basketball
            ctx.fill();
            ctx.closePath();
        }
    }

    drawHoop();

    // Draw hand indicators
    [leftHand, rightHand].forEach(handObj => {
        if (handObj.visible) {
            ctx.beginPath();
            ctx.arc(handObj.x, handObj.y, handObj.radius, 0, Math.PI * 2);
            ctx.fillStyle = handObj.color;
            ctx.fill();

            if (handObj.isPinching) {
                ctx.beginPath();
                ctx.arc(handObj.x, handObj.y, handObj.radius * 0.7, 0, Math.PI * 2);
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 5;
                ctx.stroke();
            }

            // Draw smaller indicators for thumb and index finger
            if (handObj.thumbPos && handObj.indexPos) {
                ctx.beginPath();
                ctx.arc(handObj.thumbPos.x, handObj.thumbPos.y, 10, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; // White for thumb
                ctx.fill();

                ctx.beginPath();
                ctx.arc(handObj.indexPos.x, handObj.indexPos.y, 10, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; // White for index
                ctx.fill();
            }
        }
    });

    drawScore();

    // Draw FPS in top middle
    const avgFPS = frameTimes.length > 0 ? (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length).toFixed(1) : 0;
    ctx.font = "24px Arial";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.fillText(`FPS: ${avgFPS}`, canvas.width / 2, 30);
}

function drawScore() {
    const now = Date.now();
    ctx.font = "48px Arial";
    ctx.textAlign = "left";
    ctx.fillStyle = (now < leftFlashEndTime) ? "green" : "white";
    ctx.fillText(`Left: ${leftScore}`, 50, 60);

    ctx.textAlign = "right";
    ctx.fillStyle = (now < rightFlashEndTime) ? "green" : "white";
    ctx.fillText(`Right: ${rightScore}`, canvas.width - 50, 60);
}

function drawFloor() {
    ctx.fillStyle = '#556B2F'; // Dark Olive Green
    ctx.fillRect(0, canvas.height - 30, canvas.width, 30); // 20px high floor
}

function drawHoop() {
    drawSingleHoop(hoop, true); // Left hoop, flipped to face center
    drawSingleHoop(hoopRight, false); // Right hoop, flipped to face center
}

function drawSingleHoop(hoopObj, flipped) {
    if (hoopImage.complete && hoopImage.naturalHeight !== 0) {
        const aspectRatio = hoopImage.naturalWidth / hoopImage.naturalHeight;
        const drawHeight = hoopObj.width / aspectRatio;

        ctx.save(); // Save the current canvas state
        if (flipped) {
            ctx.scale(-1, 1); // Flip horizontally
            ctx.drawImage(hoopImage, -hoopObj.x - hoopObj.width, hoopObj.y - drawHeight, hoopObj.width, drawHeight);
        } else {
            ctx.drawImage(hoopImage, hoopObj.x, hoopObj.y - drawHeight, hoopObj.width, drawHeight);
        }
        ctx.restore(); // Restore the canvas to its original state
    } else {
        // Fallback to drawing the hoop procedurally
        const rimCenterX = hoopObj.x + hoopObj.width / 2;
        const rimCenterY = hoopObj.y;

        // Backboard (larger)
        ctx.fillStyle = hoopObj.backboardColor;
        ctx.fillRect(hoopObj.x, hoopObj.y - hoopObj.backboardHeight, hoopObj.width, hoopObj.backboardHeight);

        // Rectangle in the center of the backboard
        const rectWidth = hoopObj.width * 0.3;
        const rectHeight = hoopObj.backboardHeight * 0.3;
        const rectX = hoopObj.x + (hoopObj.width - rectWidth) / 2;
        const rectY = hoopObj.y - hoopObj.backboardHeight + (hoopObj.backboardHeight - rectHeight) / 2;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);

        // Post (simplified, extends from backboard)
        ctx.fillStyle = 'gray';
        ctx.fillRect(hoopObj.x + hoopObj.width / 2 - 10, hoopObj.y + hoopObj.rimRadiusY, 20, canvas.height - (hoopObj.y + hoopObj.rimRadiusY));

        // Rim (oval/ellipse)
        ctx.strokeStyle = hoopObj.rimColor;
        ctx.lineWidth = hoopObj.rimRadiusY * 2; // Thickness of the rim line
        ctx.beginPath();
        ctx.ellipse(rimCenterX, rimCenterY, hoopObj.rimRadiusX, hoopObj.rimRadiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.closePath();

        // Net under the hoop (diagonal grid)
        const netHeight = 80;
        const numSegments = 10;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;

        for (let i = 0; i <= numSegments; i++) {
            const y = rimCenterY + (netHeight / numSegments) * i;
            const startX = rimCenterX - hoopObj.rimRadiusX * (1 - i / (numSegments * 2));
            const endX = rimCenterX + hoopObj.rimRadiusX * (1 - i / (numSegments * 2));

            // Diagonal lines (left to right)
            if (i < numSegments) {
                ctx.beginPath();
                ctx.moveTo(startX, y);
                ctx.lineTo(rimCenterX + hoopObj.rimRadiusX * (1 - (i + 1) / (numSegments * 2)), y + (netHeight / numSegments));
                ctx.stroke();
            }

            // Diagonal lines (right to left)
            if (i < numSegments) {
                ctx.beginPath();
                ctx.moveTo(endX, y);
                ctx.lineTo(rimCenterX - hoopObj.rimRadiusX * (1 - (i + 1) / (numSegments * 2)), y + (netHeight / numSegments));
                ctx.stroke();
            }
        }
    }
}

// --- Start ---
document.addEventListener('DOMContentLoaded', main);

canvas.addEventListener('mousedown', (e) => {
    const mouseX = e.clientX - canvas.getBoundingClientRect().left;
    const mouseY = e.clientY - canvas.getBoundingClientRect().top;

    // Check if a rim post is clicked
    if (isPointInCircle(mouseX, mouseY, hoop.rimPostLeft.x, hoop.rimPostLeft.y, hoop.rimPostLeft.radius)) {
        isDragging = true;
        draggedHoop = hoop;
        draggedPost = 'rimPostLeft';
    } else if (isPointInCircle(mouseX, mouseY, hoop.rimPostRight.x, hoop.rimPostRight.y, hoop.rimPostRight.radius)) {
        isDragging = true;
        draggedHoop = hoop;
        draggedPost = 'rimPostRight';
    } else if (isPointInCircle(mouseX, mouseY, hoopRight.rimPostLeft.x, hoopRight.rimPostLeft.y, hoopRight.rimPostLeft.radius)) {
        isDragging = true;
        draggedHoop = hoopRight;
        draggedPost = 'rimPostLeft';
    } else if (isPointInCircle(mouseX, mouseY, hoopRight.rimPostRight.x, hoopRight.rimPostRight.y, hoopRight.rimPostRight.radius)) {
        isDragging = true;
        draggedHoop = hoopRight;
        draggedPost = 'rimPostRight';
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (isDragging && draggedHoop && draggedPost) {
        const mouseX = e.clientX - canvas.getBoundingClientRect().left;
        const mouseY = e.clientY - canvas.getBoundingClientRect().top;

        draggedHoop[draggedPost].x = mouseX;
        draggedHoop[draggedPost].y = mouseY;
    }
});

canvas.addEventListener('mouseup', () => {
    isDragging = false;
    draggedHoop = null;
    draggedPost = null;
});

function isPointInCircle(px, py, cx, cy, r) {
    const distance = Math.sqrt(Math.pow(px - cx, 2) + Math.pow(py - cy, 2));
    return distance < r;
}

function isPointInRect(px, py, rx, ry, rw, rh) {
    return px > rx && px < rx + rw && py > ry && py < ry + rh;
}

function saveCoordinates() {
    const coordinates = {
        leftHoop: {
            rimPostLeft: hoop.rimPostLeft,
            rimPostRight: hoop.rimPostRight
        },
        rightHoop: {
            rimPostLeft: hoopRight.rimPostLeft,
            rimPostRight: hoopRight.rimPostRight
        }
    };

    console.log('Saved Coordinates:', JSON.stringify(coordinates, null, 2));
    alert('Coordinates saved to console!');
}
