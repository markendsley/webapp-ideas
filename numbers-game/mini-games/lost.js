class LostGame {
    constructor(container, onExit) {
        this.container = container;
        this.onExit = onExit;
        this.canvas = null;
        this.ctx = null;
        this.ui = null;
        this.animId = null;
        
        // Game State
        this.frame = 0;
        this.distance = 0;
        this.speed = 0;
        this.maxSpeed = 8;
        this.darkness = 0.0;
        this.shakeIntensity = 0;
        this.gameState = 'playing';
        this.jeepState = 'driving'; // 'driving' or 'crashed'
        
        this.keys = { ArrowRight: false, ArrowLeft: false };
        this.boundKeydown = this.handleKeydown.bind(this);
        this.boundKeyup = this.handleKeyup.bind(this);

        // Assets
        this.C = {
            sky: '#1a0b2e', ground: '#0f0518', treeFar: '#2d1b4e', treeNear: '#110022',
            jeepBody: '#5d5d5d', jeepAccent: '#8a2be2', skin: '#d2a679',
            hat: '#3e2723', shirt: '#4a6fa5', blood: '#8a0000'
        };
        
        this.trees = [];
        for (let i = 0; i < 40; i++) {
            this.trees.push({
                x: Math.random() * 320,
                w: 10 + Math.random() * 20,
                h: 40 + Math.random() * 80,
                layer: Math.random() > 0.5 ? 1 : 2
            });
        }
    }

    start() {
        // Setup DOM
        this.container.innerHTML = `
            <div class="crt-overlay">
                <div class="scanlines"></div>
                <div class="vignette"></div>
                <div class="noise"></div>
                <canvas width="320" height="224"></canvas>
                <div class="game-ui-layer"><div class="game-message hidden"></div></div>
            </div>
        `;

        this.canvas = this.container.querySelector('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.ui = this.container.querySelector('.game-message');

        // Listeners
        window.addEventListener('keydown', this.boundKeydown);
        window.addEventListener('keyup', this.boundKeyup);

        // Instructions
        this.showText("PRESS RIGHT ARROW", "text-ominous");
        setTimeout(() => this.hideText(), 3000);

        this.loop();
    }

    stop() {
        this.gameState = 'stopped';
        cancelAnimationFrame(this.animId);
        window.removeEventListener('keydown', this.boundKeydown);
        window.removeEventListener('keyup', this.boundKeyup);
        this.container.innerHTML = '';
        if (this.onExit) this.onExit();
    }

    handleKeydown(e) { if (this.keys.hasOwnProperty(e.code)) this.keys[e.code] = true; }
    handleKeyup(e) { if (this.keys.hasOwnProperty(e.code)) this.keys[e.code] = false; }

    update() {
        if (this.gameState !== 'playing') return;

        // Movement
        if (this.keys.ArrowRight) this.speed += 0.05;
        else if (this.keys.ArrowLeft) this.speed -= 0.2;
        else this.speed -= 0.05;

        if (this.speed < 0) this.speed = 0;
        if (this.speed > this.maxSpeed) this.speed = this.maxSpeed;

        this.distance += this.speed;
        this.frame++;

        // Parallax
        this.trees.forEach(t => {
            const layerSpeed = t.layer === 1 ? this.speed * 0.5 : this.speed;
            t.x -= layerSpeed;
            if (t.x + t.w < 0) {
                t.x = 320 + Math.random() * 50;
                t.h = 40 + Math.random() * 80;
            }
        });

        this.handleEvents();
        if (this.shakeIntensity > 0) this.shakeIntensity *= 0.9;
    }

    handleEvents() {
        // 1. Warning
        if (this.distance > 15000 && this.distance < 15500) {
            this.showText("Turn back now", "text-ominous");
        } else if (this.distance > 18000 && this.distance < 18500) {
            this.hideText();
        }

        // 2. The Crash
        if (this.distance > 20000) {
            this.jeepState = 'crashed';
        }

        // 3. Darkness
        if (this.distance > 25000) {
            this.darkness = Math.min(0.95, this.darkness + 0.0005);
        }

        // 4. Horror
        if (this.distance > 40000) {
            this.shakeIntensity = 5;
            this.showText("IT HURTS", "text-bloody");
            if (Math.random() > 0.8) {
                this.ctx.fillStyle = this.C.blood;
                this.ctx.fillRect(0, 0, 320, 224);
            }
        }

        // 5. End
        if (this.distance > 45000) {
            this.gameState = 'over';
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, 320, 224);
            this.ui.innerHTML = "<span style='color:red; font-size:1rem;'>CONNECTION LOST</span>";
            this.ui.classList.remove('hidden');
            
            // Auto exit after 5 seconds
            setTimeout(() => this.stop(), 5000);
        }
    }

    draw() {
        if (this.gameState === 'over') return;

        // Clear
        this.ctx.fillStyle = this.C.sky;
        this.ctx.fillRect(0, 0, 320, 224);

        // Shake
        const dx = (Math.random() - 0.5) * this.shakeIntensity;
        const dy = (Math.random() - 0.5) * this.shakeIntensity;
        this.ctx.save();
        this.ctx.translate(dx, dy);

        // Moon
        this.ctx.fillStyle = '#4b3b6b';
        this.ctx.beginPath();
        this.ctx.arc(250, 40, 20, 0, Math.PI * 2);
        this.ctx.fill();

        // Ground
        this.ctx.fillStyle = this.C.ground;
        this.ctx.fillRect(0, 160, 320, 64);

        // Trees
        this.ctx.fillStyle = this.C.treeFar;
        this.trees.filter(t => t.layer === 1).forEach(t => this.drawTree(t.x, 160, t.w, t.h));
        this.ctx.fillStyle = this.C.treeNear;
        this.trees.filter(t => t.layer === 2).forEach(t => this.drawTree(t.x, 170, t.w, t.h * 1.2));

        // Jeep
        this.drawJeep(80, 155);

        // Darkness
        const gradient = this.ctx.createRadialGradient(140, 160, 30, 140, 160, 200);
        const alphaCenter = Math.max(0, this.darkness - 0.2); 
        const alphaEdge = Math.min(1, 0.4 + this.darkness);
        gradient.addColorStop(0, `rgba(0,0,0,${alphaCenter})`);
        gradient.addColorStop(1, `rgba(0,0,0,${alphaEdge})`);
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, 320, 224);

        // Scanlines
        if (this.frame % 2 === 0) {
            this.ctx.fillStyle = 'rgba(0,0,0,0.1)';
            for(let y=0; y<224; y+=2) this.ctx.fillRect(0, y, 320, 1);
        }

        this.ctx.restore();
    }

    drawTree(x, y, w, h) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + w/2, y - h);
        this.ctx.lineTo(x + w, y);
        this.ctx.lineTo(x, y);
        this.ctx.fill();
    }

    drawJeep(x, y) {
        if (this.jeepState === 'crashed') {
            this.ctx.save();
            this.ctx.translate(x + 35, y + 10);
            this.ctx.rotate(0.2);

            // Detached wheels
            this.drawWheel(10, 20, 1, true);
            this.drawWheel(50, 10, 3, true);

            // Crashed Body
            this.ctx.fillStyle = this.C.jeepBody;
            this.ctx.fillRect(-35, -25, 70, 25);
            this.ctx.fillRect(-25, -40, 40, 15);
            this.ctx.fillStyle = this.C.jeepAccent;
            this.ctx.fillRect(-35, -5, 70, 4);

            // Broken windshield
            this.ctx.strokeStyle = '#333';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(-20, -25);
            this.ctx.lineTo(-20, -45);
            this.ctx.lineTo(15, -45);
            this.ctx.lineTo(25, -25);
            this.ctx.stroke();

            // No man, sad
            this.ctx.restore();
        } else { // Driving
            const bounce = (this.speed > 0) ? Math.sin(this.frame * 0.5) * 1 : 0;
            const by = y + bounce;

            this.ctx.fillStyle = '#111';
            this.drawWheel(x + 10, by + 15, this.frame * this.speed);
            this.drawWheel(x + 55, by + 15, this.frame * this.speed);

            this.ctx.fillStyle = this.C.jeepBody;
            this.ctx.fillRect(x, by - 10, 70, 25);
            this.ctx.fillRect(x + 10, by - 25, 40, 15);
            this.ctx.fillStyle = this.C.jeepAccent;
            this.ctx.fillRect(x, by, 70, 4);

            this.ctx.strokeStyle = '#333';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(x + 15, by - 10);
            this.ctx.lineTo(x + 15, by - 30);
            this.ctx.lineTo(x + 50, by - 30);
            this.ctx.lineTo(x + 60, by - 10);
            this.ctx.stroke();

            this.drawMan(x + 25, by - 15);
        }
    }

    drawWheel(x, y, rotation, broken = false) {
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(rotation * 0.1);
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.beginPath(); this.ctx.arc(0, 0, 9, 0, Math.PI * 2); this.ctx.fill();
        this.ctx.fillStyle = '#555';
        this.ctx.beginPath(); this.ctx.arc(0, 0, 4, 0, Math.PI * 2); this.ctx.fill();
        this.ctx.strokeStyle = '#333';
        this.ctx.beginPath();
        if (broken) {
            this.ctx.moveTo(-7, -5); this.ctx.lineTo(8, 2);
            this.ctx.moveTo(-5, 7); this.ctx.lineTo(3, -8);
        } else {
            this.ctx.moveTo(-9, 0); this.ctx.lineTo(9, 0);
            this.ctx.moveTo(0, -9); this.ctx.lineTo(0, 9);
        }
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawMan(x, y) {
        this.ctx.fillStyle = this.C.shirt;
        this.ctx.fillRect(x, y, 14, 16);
        this.ctx.save();
        this.ctx.translate(x + 10, y + 8);
        this.ctx.rotate(-0.5);
        this.ctx.fillRect(0, 0, 12, 4);
        this.ctx.restore();
        this.ctx.fillStyle = this.C.skin;
        this.ctx.fillRect(x + 2, y - 10, 10, 10);
        this.ctx.fillStyle = this.C.hat;
        this.ctx.fillRect(x - 2, y - 12, 18, 4);
        this.ctx.fillRect(x + 2, y - 16, 10, 6);
    }

    showText(text, className) {
        this.ui.textContent = text;
        this.ui.className = 'game-message ' + className;
    }

    hideText() {
        this.ui.classList.add('hidden');
    }

    loop() {
        if (this.gameState === 'stopped') return;
        this.update();
        this.draw();
        this.animId = requestAnimationFrame(() => this.loop());
    }
}