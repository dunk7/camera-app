
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
    airResistance: 0.995
};
const balls = [];
const ballRadius = 30;
const MAX_BALLS = 10;

const hand = {
    x: 0, y: 0, radius: 70,
    color: 'rgba(0, 220, 255, 0.5)',
    visible: false,
    dx: 0, dy: 0,
    isPinching: false,
    heldBall: null, // Reference to the ball being held
    releaseCounter: 0, // Counter for delayed release
    velocityHistory: [], // For averaging velocity
    thumbPos: { x: 0, y: 0 },
    indexPos: { x: 0, y: 0 }
};

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

const saveButton = {
    x: 50,
    y: 50,
    width: 200,
    height: 50,
    text: 'Save Coordinates',
    color: 'blue',
    textColor: 'white'
};

// --- Main Setup Function ---
async function main() {
    try {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        await setupCamera(); // Ensure camera is set up first

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

        gameLoop();
    } catch (error) {
        console.error("Setup failed:", error);
        ctx.fillStyle = 'white';
        ctx.font = '20px Arial';
        ctx.fillText(`ERROR: ${error.message}`, 20, 50);
    }
}

// --- Initialization ---
async function setupCamera() {
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
            alert("Camera access denied. Please allow camera access in your browser settings.");
        } else if (error.name === 'NotFoundError') {
            alert("No camera found. Please ensure a camera is connected and enabled.");
        } else {
            alert(`Failed to access camera: ${error.message}`);
        }
        throw error; // Re-throw to stop further execution if camera fails
    }
}

async function loadHandTrackingModel() {
    if (typeof handPoseDetection === 'undefined') {
        throw new Error("handPoseDetection library not loaded. Check script order in index.html.");
    }
    const model = handPoseDetection.SupportedModels.MediaPipeHands;
    const detectorConfig = { runtime: 'mediapipe', solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240' };
    detector = await handPoseDetection.createDetector(model, detectorConfig);
}

// --- Main Game Loop ---
async function gameLoop() {
    let predictions = [];
    if (detector && video.readyState >= 2) {
        predictions = await detector.estimateHands(video);
    }

    updateHandState(predictions);
    updateBalls();
    checkHandCollisions();
    checkRimCollisions(); // New collision check for the rim
    checkBallCollisions(); // Ensure ball-to-ball collisions are checked
    checkScore();

    draw();

    requestAnimationFrame(gameLoop);
}

// --- Update Functions ---
function updateHandState(predictions) {
    if (predictions.length > 0) {
        lastHandDetectionTime = Date.now();
        const keypoints = predictions[0].keypoints;

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
            hand.isPinching = dist < PINCH_THRESHOLD;

            const midPoint = { x: (thumbTip.x + indexTip.x) / 2, y: (thumbTip.y + indexTip.y) / 2 };
            const mappedMidPoint = mapToCanvas(midPoint);
            const targetX = mappedMidPoint.x;
            const targetY = mappedMidPoint.y;

            const mappedThumb = mapToCanvas(thumbTip);
            hand.thumbPos.x = mappedThumb.x;
            hand.thumbPos.y = mappedThumb.y;

            const mappedIndex = mapToCanvas(indexTip);
            hand.indexPos.x = mappedIndex.x;
            hand.indexPos.y = mappedIndex.y;

            if (!isNaN(targetX) && !isNaN(targetY)) {
                hand.visible = true;
                
                hand.dx = targetX - hand.x;
                hand.dy = targetY - hand.y;

                hand.velocityHistory.push({ dx: hand.dx, dy: hand.dy });
                if (hand.velocityHistory.length > 3) {
                    hand.velocityHistory.shift();
                }

                hand.x += (targetX - hand.x) * SMOOTHING_FACTOR;
                hand.y += (targetY - hand.y) * SMOOTHING_FACTOR;

            } else {
                hand.visible = false;
            }
        } else {
            hand.isPinching = false;
            hand.visible = false;
        }
    } else {
        hand.isPinching = false;
        if (Date.now() - lastHandDetectionTime < HAND_PERSISTENCE_MS) {
            hand.visible = true;
            hand.x += hand.dx * 0.5;
            hand.y += hand.dy * 0.5;
        } else {
            hand.visible = false;
            hand.dx = 0;
            hand.dy = 0;
        }
    }
}

function updateBalls() {
    for (let i = balls.length - 1; i >= 0; i--) {
        const ball = balls[i];

        if (ball.isCaught) {
            ball.x = hand.x;
            ball.y = hand.y;
            ball.dx = hand.dx;
            ball.dy = hand.dy;

            if (!hand.isPinching) {
                hand.releaseCounter++;
                if (hand.releaseCounter >= 4) { // Changed from 2 to 4
                    ball.isCaught = false;
                    hand.heldBall = null;
                    hand.releaseCounter = 0;

                    // Calculate average velocity
                    const avgVelocity = hand.velocityHistory.reduce((acc, v) => {
                        acc.dx += v.dx;
                        acc.dy += v.dy;
                        return acc;
                    }, { dx: 0, dy: 0 });

                    avgVelocity.dx /= hand.velocityHistory.length;
                    avgVelocity.dy /= hand.velocityHistory.length;

                    ball.dx = avgVelocity.dx * 1.5;
                    ball.dy = avgVelocity.dy * 1.5;
                    ball.ignoreHandCollisionUntil = Date.now() + 500;
                }
            } else {
                hand.releaseCounter = 0; // Reset counter if pinching again
            }
        } else {
            // Apply gravity
            ball.dy += engine.gravity;
            
            // Apply air resistance
            ball.dx *= engine.airResistance;
            ball.dy *= engine.airResistance;
            
            // Update position
            ball.x += ball.dx;
            ball.y += ball.dy;

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
    if (!hand.visible) return;

    for (const ball of balls) {
        if (ball.isCaught) continue;
        if (ball.ignoreHandCollisionUntil && Date.now() < ball.ignoreHandCollisionUntil) {
            continue; // Skip collision if ignoring hand physics
        }

        const dx = ball.x - hand.x;
        const dy = ball.y - hand.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = ball.radius + hand.radius;

        if (distance < minDistance) {
            if (hand.isPinching && !hand.heldBall) { // Can only grab if not already holding a ball
                ball.isCaught = true;
                hand.heldBall = ball; // Keep track of the held ball
            } else if (!hand.heldBall) { // Only apply physics if not holding a ball
                const angle = Math.atan2(dy, dx);
                const overlap = minDistance - distance;

                ball.x += Math.cos(angle) * overlap * 0.5;
                ball.y += Math.sin(angle) * overlap * 0.5;

                ball.dx += hand.dx * 0.6;
                ball.dy += hand.dy * 0.6;

                ball.dx += Math.cos(angle) * 2;
                ball.dy += Math.sin(angle) * 2;
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
    checkSingleHoopScore(hoop);
    checkSingleHoopScore(hoopRight);
}

function checkSingleHoopScore(hoopObj) {
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
            score++;
            ball.scored = true;
            console.log("Score! Current Score: ", score);
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
        isCaught: false,
        scored: false,
        mass: 1 // Add mass property for physics calculations
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawFloor();
    drawHoop();

    // Draw balls
    for (const ball of balls) {
        if (basketballImage.complete && basketballImage.naturalHeight !== 0) {
            // Draw image if loaded
            ctx.drawImage(basketballImage, ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);
        } else {
            // Fallback to drawing a circle if image not loaded
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
            ctx.fillStyle = '#FF8C00'; // Dark Orange for basketball
            ctx.fill();
            ctx.closePath();
        }
    }

    // Draw hand indicator
    if (hand.visible) {
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, hand.radius, 0, Math.PI * 2);
        ctx.fillStyle = hand.color;
        ctx.fill();

        if (hand.isPinching) {
            ctx.beginPath();
            ctx.arc(hand.x, hand.y, hand.radius * 0.7, 0, Math.PI * 2);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 5;
            ctx.stroke();
        }

        // Draw smaller indicators for thumb and index finger
        if (hand.thumbPos && hand.indexPos) {
            ctx.beginPath();
            ctx.arc(hand.thumbPos.x, hand.thumbPos.y, 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 0, 0, 0.7)'; // Red for thumb
            ctx.fill();

            ctx.beginPath();
            ctx.arc(hand.indexPos.x, hand.indexPos.y, 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 0, 255, 0.7)'; // Blue for index
            ctx.fill();
        }
    }

    drawScore();

    // Draw Save Button
    ctx.fillStyle = saveButton.color;
    ctx.fillRect(saveButton.x, saveButton.y, saveButton.width, saveButton.height);
    ctx.fillStyle = saveButton.textColor;
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(saveButton.text, saveButton.x + saveButton.width / 2, saveButton.y + saveButton.height / 2);
}

function drawScore() {
    ctx.font = "48px Arial";
    ctx.fillStyle = "white";
    ctx.textAlign = "right";
    ctx.fillText(`Score: ${score}`, canvas.width - 50, 60);
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

    // Draw the two rim posts for debugging
    ctx.beginPath();
    ctx.arc(hoopObj.rimPostLeft.x, hoopObj.rimPostLeft.y, hoopObj.rimPostLeft.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'red';
    ctx.fill();
    ctx.closePath();

    ctx.beginPath();
    ctx.arc(hoopObj.rimPostRight.x, hoopObj.rimPostRight.y, hoopObj.rimPostRight.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'red';
    ctx.fill();
    ctx.closePath();
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
    } else if (isPointInRect(mouseX, mouseY, saveButton.x, saveButton.y, saveButton.width, saveButton.height)) {
        saveCoordinates();
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
