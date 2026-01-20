
// Mock THREE.Color for nodejs environment
class Color {
    constructor(r, g, b) {
        if (typeof r === 'number') {
            this.r = r; this.g = g; this.b = b;
        } else {
            this.r = 0; this.g = 1; this.b = 1; // Default Cyan
        }
    }
    lerp(c, t) {
        this.r += (c.r - this.r) * t;
        this.g += (c.g - this.g) * t;
        this.b += (c.b - this.b) * t;
        return this;
    }
    getStyle() {
        return `rgb(${Math.round(this.r*255)}, ${Math.round(this.g*255)}, ${Math.round(this.b*255)})`;
    }
}

const CONFIG = { colorBase: new Color(0, 1, 1) };

// Current Implementation
function getSpectralColor_Current(dataArray) {
    if (!dataArray) return new Color(0, 1, 1);

    let r = 0, g = 0, b = 0;
    const len = dataArray.length;
    
    for (let i = 0; i < len; i++) {
        let val = dataArray[i] / 255.0;
        let freqNorm = i / len;
        
        let weightR = Math.exp(-50 * Math.pow(freqNorm - 0.1, 2)) + 
                      Math.exp(-50 * Math.pow(freqNorm - 0.9, 2));
        let weightG = Math.exp(-50 * Math.pow(freqNorm - 0.4, 2));
        let weightB = Math.exp(-50 * Math.pow(freqNorm - 0.7, 2));
        
        r += val * weightR;
        g += val * weightG;
        b += val * weightB;
    }
    
    let total = r + g + b;
    if (total > 0) {
        r = Math.pow(r / total, 0.8) * 2.0; 
        g = Math.pow(g / total, 0.8) * 2.0;
        b = Math.pow(b / total, 0.8) * 2.0;
    }
    
    r = Math.min(1.0, r);
    g = Math.min(1.0, g);
    b = Math.min(1.0, b);
    
    let finalColor = new Color(r, g, b);
    finalColor.lerp(CONFIG.colorBase, 0.2); 
    
    return finalColor;
}

// Proposed Implementation: Frequency Center -> Hue
function getSpectralColor_New(dataArray) {
    if (!dataArray) return new Color(0, 1, 1);

    const len = dataArray.length;
    let weightedSum = 0;
    let totalSum = 0;

    // Calculate Spectral Centroid
    for (let i = 0; i < len; i++) {
        let val = dataArray[i];
        weightedSum += val * i;
        totalSum += val;
    }

    if (totalSum === 0) return new Color(0, 1, 1);

    // Normalize Centroid (0.0 - 1.0)
    // Most voice/music energy is in the lower half of FFT bins
    let centroid = (weightedSum / totalSum) / (len * 0.5); 
    centroid = Math.min(1.0, Math.max(0.0, centroid));

    // Map Centroid to Hue
    // Low Freq (Bass) -> 0.0 -> Cyan/Blue
    // High Freq (Treble) -> 1.0 -> Purple/Pink
    
    // We want a cool palette: Cyan (0.5) -> Blue (0.66) -> Purple (0.75) -> Magenta (0.83)
    // Let's map 0.0-1.0 to Hue 0.5 - 0.9
    let hue = 0.5 + centroid * 0.4; 
    
    // Convert HSL to RGB
    // Saturation = 1.0 (Full Color), Lightness = 0.6 (Bright)
    return hslToRgb(hue, 1.0, 0.6);
}

// Helper: HSL to RGB
function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return new Color(r, g, b);
}

// --- Test Cases ---
const length = 1024;
const mockData_WhiteNoise = new Uint8Array(length).fill(200); // All high
const mockData_Bass = new Uint8Array(length).map((_, i) => i < 100 ? 255 : 0); // Low freq only
const mockData_Treble = new Uint8Array(length).map((_, i) => i > 800 ? 255 : 0); // High freq only

console.log("--- Current Logic Analysis ---");
let c1 = getSpectralColor_Current(mockData_WhiteNoise);
console.log(`White Noise: R=${c1.r.toFixed(2)}, G=${c1.g.toFixed(2)}, B=${c1.b.toFixed(2)}  (Is it white? ${c1.r>0.8 && c1.g>0.8 && c1.b>0.8})`);

let c2 = getSpectralColor_Current(mockData_Bass);
console.log(`Bass:        R=${c2.r.toFixed(2)}, G=${c2.g.toFixed(2)}, B=${c2.b.toFixed(2)}`);

console.log("\n--- New Logic Analysis ---");
let n1 = getSpectralColor_New(mockData_WhiteNoise);
console.log(`White Noise: R=${n1.r.toFixed(2)}, G=${n1.g.toFixed(2)}, B=${n1.b.toFixed(2)} (Ideally Cyan/Blue)`);

let n2 = getSpectralColor_New(mockData_Bass);
console.log(`Bass:        R=${n2.r.toFixed(2)}, G=${n2.g.toFixed(2)}, B=${n2.b.toFixed(2)} (Ideally Cyan)`);

let n3 = getSpectralColor_New(mockData_Treble);
console.log(`Treble:      R=${n3.r.toFixed(2)}, G=${n3.g.toFixed(2)}, B=${n3.b.toFixed(2)} (Ideally Purple)`);
