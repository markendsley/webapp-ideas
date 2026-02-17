// ============================================================
// Chaos Effects — Crazy things that happen in the browser
// ============================================================

function triggerConfetti(x, y) {
    const colors = ['#f00', '#0f0', '#00f', '#ff0', '#0ff', '#f0f', '#fff'];
    
    for (let i = 0; i < 30; i++) {
        const el = document.createElement('div');
        el.style.position = 'fixed';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.width = (5 + Math.random() * 5) + 'px';
        el.style.height = (5 + Math.random() * 5) + 'px';
        el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        el.style.pointerEvents = 'none';
        el.style.zIndex = '10000';
        el.style.borderRadius = '50%';
        document.body.appendChild(el);

        // Random velocity
        const angle = Math.random() * Math.PI * 2;
        const velocity = 5 + Math.random() * 10;
        let dx = Math.cos(angle) * velocity;
        let dy = Math.sin(angle) * velocity;
        
        let frame = 0;
        function animate() {
            el.style.left = (parseFloat(el.style.left) + dx) + 'px';
            el.style.top = (parseFloat(el.style.top) + dy) + 'px';
            dy += 0.5; // gravity
            dx *= 0.95; // friction
            
            frame++;
            if (frame < 60) {
                el.style.opacity = 1 - (frame / 60);
                requestAnimationFrame(animate);
            } else {
                el.remove();
            }
        }
        animate();
    }
}