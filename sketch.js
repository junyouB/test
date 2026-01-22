import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 全局变量
let scene, camera, renderer;
let horseMesh, mixer; // 动态马模型和动画混合器
let ambientParticles; // 环境粒子系统
let clock = new THREE.Clock(); // 用于动画计时
let time = 0;
let currentOrbitAngle = 0; // 累积的轨道角度

// 原生 Web Audio API 对象
let audioContext;
let analyser;
let dataArray;
let source;
let isAudioStarted = false;

// 状态变量
let cohesionFactor = 0; // 0 (离散/躁动) -> 1 (凝聚/平滑)

// --- 模式配置 ---
const URL_PARAMS = new URLSearchParams(window.location.search);
// 默认模式: 'interactive' (麦克风); 可选: 'demo' (自动演示)
// 如果 URL 中有 ?mode=demo 或者文件名包含 demo.html，则切换到演示模式
const IS_DEMO = URL_PARAMS.get('mode') === 'demo' || window.location.pathname.includes('demo.html');

const CONFIG = {
    opacity: 0.9,      // 粒子透明度
    pointSize: 2.0,    // 基础点大小
    colorBase: new THREE.Color(0x00ffff), // 青蓝色
    ambientCount: 3000, // 环境粒子数量
    sensitivity: 3.0,   // 音频敏感度倍增 (Mobile Optimization)
    demoSpeed: 0.5      // 演示模式下虚拟声音的变化速度
};

// --- 工具函数：环境粒子颜色 ---
function getEtchingColor() {
    const c = new THREE.Color(0x00ffff);
    // 稍微随机化一点亮度
    c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
    return c;
}

// --- 颜色映射算法：将频谱重心转换为 Hue ---
function getSpectralColor(dataArray) {
    if (!dataArray) return new THREE.Color(0x00ffff);

    const len = dataArray.length;
    let weightedSum = 0;
    let totalSum = 0;

    // 计算频谱重心 (Spectral Centroid)
    for (let i = 0; i < len; i++) {
        let val = dataArray[i];
        weightedSum += val * i;
        totalSum += val;
    }

    if (totalSum === 0) return new THREE.Color(0x00ffff);

    // 归一化重心 (0.0 - 1.0)
    // 大部分人声/音乐能量集中在前半部分，所以分母乘 0.5 来提高灵敏度
    let centroid = (weightedSum / totalSum) / (len * 0.5); 
    centroid = Math.min(1.0, Math.max(0.0, centroid));

    // 将重心映射到色相 (Hue)
    // 我们希望保持冷色调风格：
    // 低频 (Bass) -> 0.5 (Cyan/青色)
    // 中频 (Mids) -> 0.66 (Blue/蓝色)
    // 高频 (Treble) -> 0.85 (Magenta/紫红)
    let hue = 0.5 + centroid * 0.35; 
    
    // 使用 HSL 转换颜色，保持高饱和度和亮度
    // Saturation = 1.0 (确保不发白)
    // Lightness = 0.6 (保持明亮但有色彩)
    let color = new THREE.Color();
    color.setHSL(hue, 1.0, 0.6);
    
    return color;
}

function init() {
    // 1. 初始化 Three.js 场景
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000); // 纯黑背景
    scene.fog = new THREE.FogExp2(0x000000, 0.002);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(200, 100, 300);
    camera.lookAt(0, 50, 0);

    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        preserveDrawingBuffer: true // 允许保留缓冲区以实现拖尾
    });
    renderer.autoClear = false; // 关键：关闭自动清除，实现累积渲染
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    // 2. 加载模型
    loadModel();
    
    // 3. 创建环境粒子
    createAmbientParticles();
    
    // 4. 创建流线系统
    streamlineSystem = new THREE.Group();
    scene.add(streamlineSystem);
    createStreamlineSystem();
    
    // 5. 创建几何图案雨系统
    createGeometricRainSystem();

    // 6. 事件监听
    window.addEventListener('resize', onResize);
    
    // 如果是交互模式，需要点击启动音频
    if (!IS_DEMO) {
        window.addEventListener('click', startAudioContext);
        // 同时支持触摸事件
        window.addEventListener('touchstart', startAudioContext);
    } else {
        // 演示模式：自动隐藏 Overlay (或者由外部 HTML 控制)
        // 并启动虚拟音频循环
        isAudioStarted = true; // 标记为已启动，虽然不需要真实 AudioContext
        // 确保 dataArray 已初始化
        dataArray = new Uint8Array(1024).fill(0);
    }
    
    // Overlay 文本由 HTML 决定，不再这里硬编码
    // addOverlayText(); 
}

// let ringSystem; // 已移除

let geometricRainSystem;
const GEO_RAIN_COUNT = 50;

function createGeometricRainSystem() {
    geometricRainSystem = new THREE.Group();
    scene.add(geometricRainSystem);
    
    // 预创建多种几何体
    const geometries = [
        new THREE.TetrahedronGeometry(2),
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.OctahedronGeometry(2),
        new THREE.IcosahedronGeometry(2)
    ];
    
    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        wireframe: true // 线框风格
    });
    
    for (let i = 0; i < GEO_RAIN_COUNT; i++) {
        const geom = geometries[Math.floor(Math.random() * geometries.length)];
        const mesh = new THREE.Mesh(geom, material);
        
        mesh.visible = false;
        mesh.userData = {
            active: false,
            velocity: new THREE.Vector3(0, -1, 0),
            rotSpeed: new THREE.Vector3(
                (Math.random()-0.5)*0.1, 
                (Math.random()-0.5)*0.1, 
                (Math.random()-0.5)*0.1
            ),
            life: 0
        };
        
        geometricRainSystem.add(mesh);
    }
}

function updateGeometricRain(level, bass, treble, spawnPos) {
    if (!geometricRainSystem) return;
    
    // 1. 发射新几何体
    // 基于音量特征：
    // Bass -> 大物体，慢速
    // Treble -> 小物体，快速
    
    // 只有当有明显声音时才发射
    if (level > 0.05 && Math.random() < level * 0.5) { // 发射概率随音量增加
        const mesh = geometricRainSystem.children.find(m => !m.userData.active);
        if (mesh) {
            mesh.visible = true;
            mesh.userData.active = true;
            mesh.userData.life = 200; // 寿命
            
            // 随机位置：改为从发射点 (spawnPos) 发射
            // 在发射点附近稍微随机一点
            const x = spawnPos.x + (Math.random() - 0.5) * 20;
            const y = spawnPos.y + (Math.random() - 0.5) * 10;
            const z = spawnPos.z + (Math.random() - 0.5) * 10;
            
            mesh.position.set(x, y, z);
            
            // 大小：Bass 越大，物体越大
            const size = 1.0 + bass * 5.0;
            mesh.scale.setScalar(size);
            
            // 速度：Treble 越大，飞得越快
            // 方向：与天路一致，向下方 (Y轴负方向) 且向后方 (Z轴负方向，假设天路向后延伸)
            // 天路逻辑是: point.y -= flowSpeed; point.z += waveZ (waveZ 是小的)
            // 其实天路主要是向下流动的 (-Y)。
            // 之前的几何体是向上 (+Y)
            // 用户要求：几何点发射方向和路一致 -> 即向下 (-Y)
            
            mesh.userData.velocity.set(
                (Math.random() - 0.5) * 1.0, // X 随机微小扩散
                -(2.0 + treble * 5.0),       // Y 向下 (与路一致)
                (Math.random() - 0.5) * 1.0  // Z 随机微小扩散
            );
            
            // 旋转：随机
            mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, 0);
        }
    }
    
    // 2. 更新活跃几何体
    geometricRainSystem.children.forEach(mesh => {
        if (mesh.userData.active) {
            mesh.position.add(mesh.userData.velocity);
            mesh.rotation.x += mesh.userData.rotSpeed.x;
            mesh.rotation.y += mesh.userData.rotSpeed.y;
            
            // 简单的重力模拟 (可选，让它们飞起来后再稍微下落)
            // mesh.userData.velocity.y -= 0.05; 
            
            mesh.userData.life--;
            
            // 边界检查：飞太低或寿命结束
             if (mesh.userData.life <= 0 || mesh.position.y < -200) {
                 mesh.userData.active = false;
                 mesh.visible = false;
             }
        }
    });
}

let streamlineSystem;
const STREAMER_COUNT = 150; // 增加数量，形成密集的路面 (30 -> 150)
const SEGMENT_COUNT = 300; // 增加长度 (200 -> 300)

function createStreamlineSystem() {
    if (!streamlineSystem) {
        streamlineSystem = new THREE.Group();
        scene.add(streamlineSystem);
    }
    
    for (let i = 0; i < STREAMER_COUNT; i++) {
        // 使用 BufferGeometry 创建线条
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(SEGMENT_COUNT * 3);
        
        // 初始化所有点在原点下方的远处，避免一开始就乱飞
        for (let j = 0; j < SEGMENT_COUNT; j++) {
            positions[j * 3] = 0;
            positions[j * 3 + 1] = -5000; // 藏在下面
            positions[j * 3 + 2] = 0;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        // 使用 LineBasicMaterial
        // 降低不透明度，让重叠部分产生光晕感
        const material = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3, // 0.8 -> 0.3
            linewidth: 1 
        });
        
        const line = new THREE.Line(geometry, material);
        
        // 存储自定义数据
        // 计算归一化位置 (-1 到 1)，用于排列成"路面"
        // 混合策略：保留主要结构，但增加高斯随机偏移填补缝隙
        
        const normalizedIndex = (i / STREAMER_COUNT) * 2 - 1; 
        
        // 高斯随机函数 (Box-Muller transform)
        function randomGaussian() {
            let u = 0, v = 0;
            while(u === 0) u = Math.random(); 
            while(v === 0) v = Math.random();
            return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
        }
        
        line.userData = {
            id: i,
            normalizedIndex: normalizedIndex,
            // 基础偏移：在 X 轴上展开
            // 使用 normalizedIndex 保证整体宽度，叠加 randomGaussian 填补缝隙
            baseOffsetX: normalizedIndex * 4 + randomGaussian() * 1.5, 
            // 随机垂直偏移 (厚度)
            offsetY: randomGaussian() * 2.0,
            
            // 波动频率
            waveSpeed: 0.01 + Math.random() * 0.01,
            waveScale: 5.0 + Math.random() * 5.0,
            
            // 历史位置数组
            history: []
        };
        
        line.frustumCulled = false; // 防止被裁剪
        
        // 初始化历史记录
        for(let k=0; k<SEGMENT_COUNT; k++) {
            line.userData.history.push({
                x: 0, 
                y: -5000, 
                z: 0, 
                active: false,
                initialX: 0 // 记录生成时的原始 X，用于后续扩散
            });
        }
        
        streamlineSystem.add(line);
    }
}

// 更新流线系统
function updateStreamlines(level, tailPos) {
    if (!streamlineSystem) return;
    
    // 只有当有声音时，才"激活"新的头部点
    // const isActive = level > 0.01; // 旧逻辑：静音时不生成
    const isActive = true; // 新逻辑：始终生成，路一直显示
    
    streamlineSystem.children.forEach((line, index) => {
        const history = line.userData.history;
        const u = line.userData;
        
        // 1. 生成新的头部点
        let newPoint = {
            x: 0, 
            y: -5000, 
            z: 0, 
            active: false,
            initialX: 0
        };
        
        if (isActive && tailPos) {
            // 在尾巴位置加上线条的固有偏移
            // 只有当有声音时，才进行额外的扩散 (扭曲/扩大)
            // 静音时：保持窄路 (baseOffsetX)
            // 声音时：baseOffsetX * (1 + level * 5.0)
            
            const spread = level * 10.0; 
            const expansion = 1.0 + level * 8.0; // 声音大时，路面大幅变宽
            
            // 基础宽度 + 声音扩展
            let currentOffsetX = u.baseOffsetX * expansion;
            
            // 增加一点随机扭曲 (Warp)
            if (level > 0.01) {
                currentOffsetX += (Math.random() - 0.5) * spread;
            }
            
            newPoint.x = tailPos.x + currentOffsetX;
            newPoint.y = tailPos.y + u.offsetY;
            newPoint.z = tailPos.z; // Z 轴对齐
            newPoint.active = true;
            newPoint.initialX = newPoint.x - tailPos.x; // 记录相对于中心的偏移量
        }
        
        // 2. 推进历史记录 (队列)
        history.unshift(newPoint);
        history.pop();
        
        // 3. 更新几何体顶点
        const positions = line.geometry.attributes.position.array;
        
        for (let i = 0; i < SEGMENT_COUNT; i++) {
            const point = history[i];
            
            if (point.active) {
                // "天路" 逻辑：
                // 1. 向下流动 (Flow Down)
                // 2. 向后延伸 (Flow Back) -> 增加透视感
                // 3. 向外扩散 (Widen) -> 形成扇形/梯形路面
                
                const age = i; // 点的"年龄"
                
                // 向下流动的速度
                const flowSpeed = 6.0; 
                point.y -= flowSpeed;
                
                // 确保均匀向后流动 (Z轴)
                // 之前 Z 轴只是随机波动，现在让它稍微往后弯曲，增加深度感
                // point.z -= 0.5; // 可选
                
                // 向外扩散 (Widening Effect)
                // 随着距离 (age) 增加，X 轴偏移量变大
                // width = initial_width * (1 + age * factor)
                // 假设 tailPos.x 大致为 0，我们直接放大 x 坐标
                // 但要保留其相对位置，所以最好是用 initialX * factor + center
                // 这里简单处理：直接放大 X
                // 为了让它看起来像透视，扩散速度要适中
                const widenFactor = 1.0 + age * 0.005; // 减缓变宽速度 (0.02 -> 0.005) 让路更直
                
                // 应用波动 (Majestic Wave)
                // 大波浪：sin(time + age * slow)
                const waveX = Math.sin(time * 2.0 + age * 0.02) * age * 0.2; 
                const waveZ = Math.cos(time * 1.5 + age * 0.02) * age * 0.1;
                
                // 最终坐标
                // X: 原始位置扩散 + 波浪
                // Y: 持续下降
                // Z: 稍微向后弯曲，形成弧度
                
                // 我们需要重新计算 X，基于它的初始相对位置
                // 如果我们不存储 initialX，点会无限扩散
                // 所以我们在生成点时记录了 initialX
                
                // 假设中心轴线 X=0 (忽略 tailPos.x 的微小变化)
                const currentX = point.initialX * widenFactor + waveX; // 相对于轴线的 X
                
                // 修正：让点沿着自己的轨迹向外飞
                // 直接使用 currentX 覆盖 point.x 是最稳健的方法，因为它基于 initialX
                // 但要注意 tailPos 的位移。
                // 我们的 point.x 应该是：当前的 tailPos.x (假设路跟随马左右移) + currentX
                // 或者：路留在原地，不跟随马左右移？通常尾迹是留在原地的。
                // 之前的逻辑：point.x += drift
                
                // 新逻辑：
                // point.x = initialWorldX + drift
                // 但我们没有存 initialWorldX，只存了 initialX (relative offset)
                // 实际上 point.x 在生成时已经是 worldX 了
                
                // 简单的扩散算法：
                // 每一帧，让 x 远离中心轴 (tailPos.x)
                // 假设中心轴是 0 (简单起见)
                if (point.x > 0) point.x += 0.1;
                else point.x -= 0.1;
                
                point.x += Math.sin(time * u.waveSpeed + i * 0.01) * 0.2; // 叠加微小波动
                
                positions[i * 3] = point.x;
                positions[i * 3 + 1] = point.y;
                positions[i * 3 + 2] = point.z + waveZ;
            } else {
                // 不活跃点处理 (同前)
                let prevActive = null;
                for(let k=i-1; k>=0; k--) {
                    if (history[k].active) {
                        prevActive = history[k];
                        break;
                    }
                }
                
                if (prevActive) {
                    positions[i * 3] = prevActive.x;
                    positions[i * 3 + 1] = prevActive.y;
                    positions[i * 3 + 2] = prevActive.z;
                } else {
                     positions[i * 3] = 0;
                     positions[i * 3 + 1] = -5000;
                     positions[i * 3 + 2] = 0;
                }
            }
        }
        
        line.geometry.attributes.position.needsUpdate = true;
    });
}

function createAmbientParticles() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    
    const range = 600; // 扩大分布范围 (400 -> 600)
    
    for (let i = 0; i < CONFIG.ambientCount; i++) {
        const x = (Math.random() - 0.5) * range;
        const y = (Math.random() - 0.5) * range * 0.5 + 50; 
        const z = (Math.random() - 0.5) * range;
        
        positions.push(x, y, z);
        
        // 颜色固定为白色
        colors.push(1.0, 1.0, 1.0);
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
        size: 1.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.3, // 降低不透明度，减少干扰
        blending: THREE.AdditiveBlending, 
        depthWrite: false
    });
    
    ambientParticles = new THREE.Points(geometry, material);
    scene.add(ambientParticles);
}

async function startAudioContext() {
    if (!isAudioStarted) {
        try {
            // 创建 AudioContext
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioContext();
            
            // 获取麦克风流
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // 创建分析器
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 1024;
            
            // 连接节点
            source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            
            // 准备数据数组
            const bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);
            
            isAudioStarted = true;
            
            // 安全隐藏 Overlay
            const overlay = document.getElementById('overlay-text');
            if (overlay) {
                overlay.style.display = 'none';
            }
            
            // 同时隐藏移动端提示
            const mobileOverlay = document.querySelector('.mobile-instruction');
            if (mobileOverlay) {
                mobileOverlay.style.display = 'none';
            }
            
            console.log("Audio started");
            
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            
        } catch (err) {
            console.error('Error accessing microphone:', err);
            
            // 更友好的错误提示，区分 HTTPS 问题和其他问题
            let msg = '无法访问麦克风。';
            
            if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
                msg += '\n\n原因：浏览器限制麦克风只能在 HTTPS 安全连接下使用。\n请确保您正在使用 https:// 开头的链接访问。';
            } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                msg += '\n\n原因：您拒绝了麦克风权限。\n请刷新页面并点击“允许”。';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                msg += '\n\n原因：未检测到麦克风设备。';
            } else {
                msg += '\n\n详细错误：' + err.message;
            }
            
            alert(msg);
        }
    }
}

let tailVertexIndex = -1; // 存储尾巴顶点的索引

// 替换 findTailVertex 为 findFrontLegsVertex
function findFrontLegsVertex(geometry) {
    const positions = geometry.attributes.position.array;
    let targetIndex = -1;
    let maxY = -Infinity; // 寻找最靠上的点 (马头朝+Y, 所以前腿应该是 Y 比较高的?)
    // 不，马的原始坐标系是:
    // 头 +Z (或 -Z)
    // 脚 -Y
    // 背 +Y
    
    // 我们要找前腿。前腿通常是 Z 轴比较靠前 (假设头是+Z)，且 Y 轴比较低 (-Y)
    
    // 假设头在 +Z 方向
    let maxZ = -Infinity; 
    
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i+1];
        const z = positions[i+2];
        
        // 筛选前腿区域：
        // 1. 低 Y (脚部) -> y < 10
        // 2. 高 Z (前部) -> z > 20
        // 3. 中轴线附近 -> abs(x) < 10
        
        if (y < 20 && z > 20 && Math.abs(x) < 10) {
             if (z > maxZ) { // 找最靠前的
                 maxZ = z;
                 targetIndex = i / 3;
             }
        }
    }
    
    // 如果没找到，尝试反向 Z (如果头在 -Z)
    if (targetIndex === -1) {
         let minZ = Infinity;
         for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i+1];
            const z = positions[i+2];
            if (y < 20 && z < -20 && Math.abs(x) < 10) {
                 if (z < minZ) {
                     minZ = z;
                     targetIndex = i / 3;
                 }
            }
        }
    }
    
    console.log("Found Front Leg Vertex Index:", targetIndex);
    return targetIndex;
}

function loadModel() {
    const loader = new GLTFLoader();
    // 加载本地 Horse.glb
    loader.load('Horse.glb', function (gltf) {
        
        const mesh = gltf.scene.children[0];
        
        // 找到尾巴顶点 -> 改为找到前腿顶点
        tailVertexIndex = findFrontLegsVertex(mesh.geometry);
        
        // 使用原始几何体，保证动画完美匹配
        const material = new THREE.PointsMaterial({
            color: CONFIG.colorBase, 
            size: CONFIG.pointSize,
            sizeAttenuation: true,
            transparent: true,
            opacity: CONFIG.opacity,
            blending: THREE.AdditiveBlending, 
            depthTest: false
        });
        
        // 注入自定义 Uniforms
        material.userData.uniforms = {
            time: { value: 0 },
            chaosFactor: { value: 0.0 } // 0 = 凝聚, 1 = 离散
        };

        material.onBeforeCompile = (shader) => {
            shader.uniforms.time = material.userData.uniforms.time;
            shader.uniforms.chaosFactor = material.userData.uniforms.chaosFactor;

            shader.vertexShader = `
                uniform float time;
                uniform float chaosFactor;
                
                // 伪随机函数
                float random(vec3 scale, float seed) {
                    return fract(sin(dot(gl_Position.xyz + seed, scale)) * 43758.5453 + seed);
                }
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>

                // --- 自定义混沌逻辑 (Inverse Logic + Trail) ---
                // 目标：振幅低(静音) -> 粒子躁动大 (chaosFactor 高)
                //      振幅高(声音) -> 粒子躁动小 (chaosFactor 低)
                
                // 1. 基础随机方向 (炸开)
                float seed = dot(transformed, vec3(12.9898, 78.233, 45.164));
                vec3 randomDir = vec3(
                    sin(seed + time * 2.0),
                    cos(seed * 1.5 + time * 1.8),
                    sin(seed * 0.7 + time * 2.2)
                );
                
                // 2. 拖尾方向 (向马后方延伸)
                // 假设马头朝 +Z，后方是 -Z
                // 增加一些随机扰动，让拖尾不是直直的一条线
                vec3 trailDir = vec3(
                    (fract(seed * 13.0) - 0.5) * 0.5, // X轴微小散射
                    (fract(seed * 7.0) - 0.5) * 0.5,  // Y轴微小散射
                    -1.5 // 主要向 Z 轴负方向 (后方)
                );
                
                // 3. 计算偏移量
                // chaosFactor 越大，偏移越大
                // randomDisplacement: 全向炸开幅度
                float randomDisplacement = pow(chaosFactor, 2.0) * 20.0;
                
                // trailLength: 向后拖拽长度
                // 让拖尾比炸开更明显，形成速度感
                float trailLength = pow(chaosFactor, 1.5) * 60.0 * fract(seed * 123.45);
                
                // 4. 应用偏移
                transformed += randomDir * randomDisplacement; // 基础炸开
                transformed += trailDir * trailLength;         // 向后拖尾
                `
            );
        };
        
        // 直接使用原始 mesh geometry
        horseMesh = new THREE.Points(mesh.geometry, material);
        
        // 确保 MorphTargets 正常工作
        if (mesh.morphTargetDictionary) {
            horseMesh.morphTargetDictionary = mesh.morphTargetDictionary;
        }
        if (mesh.morphTargetInfluences) {
            horseMesh.morphTargetInfluences = mesh.morphTargetInfluences;
        }
        
        horseMesh.scale.set(0.5, 0.5, 0.5);
        horseMesh.position.set(0, 0, 0); // 锁定在中心
        
        // 旋转马让其朝向正上方奔跑
        // 假设原始朝向是 +Z
        // 绕 X 轴旋转 -90度 -> 头朝 +Y (上)
        // 绕 Y 轴旋转 0度 -> 保持正向
        // 绕 Z 轴微调 -> 稍微侧一点好看
        horseMesh.rotation.set(-Math.PI / 2 + 0.5, 0, 0); 
        // 稍微往上抬一点，让"上方"更明显
        // horseMesh.rotation.x = -Math.PI / 3; // 移除这行，避免覆盖
        
        scene.add(horseMesh);
        
        // 初始化动画混合器
        mixer = new THREE.AnimationMixer(horseMesh);
        const clip = gltf.animations[0];
        if (clip) {
            const action = mixer.clipAction(clip);
            action.play();
        }
        
        animate();

    }, undefined, function (error) {
        console.error('Error loading model:', error);
    });
}

// 模拟音频数据 (Simplified for Performance & Rhythm)
// 移除复杂的叙事循环，改为简单的高频节奏
let lastBeatTime = 0;
let beatInterval = 1.5; // 默认节奏 1.5s
let currentSimulatedVolume = 0.5;

function simulateAudioData() {
    if (!dataArray) return;
    
    // 每 1-2 秒变换一次状态 (随机间隔)
     if (time - lastBeatTime > beatInterval) {
         lastBeatTime = time;
         // 随机下一个间隔 1.0 ~ 2.0s
         beatInterval = 1.0 + Math.random() * 1.0; 
         
         // 随机切换音量状态：
         // 修改：80% 概率静默/微弱 (0.05) -> 保持离散
         // 20% 概率强音 (0.8 ~ 1.0) -> 瞬间凝聚
         if (Math.random() < 0.8) {
             currentSimulatedVolume = 0.05; // 极低音量，彻底消散
         } else {
             currentSimulatedVolume = 0.8 + Math.random() * 0.2;
             
             // 触发视角切换 (仅在强音时)
             const cs = window.cameraState;
             if (cs) {
                 cs.mode = 'swing'; // 强制切换
                 cs.targetAngle = Math.random() * Math.PI * 2; // 全随机角度
                 cs.lastSwitchTime = time;
             }
         }
     }
    
    // 平滑过渡音量 (避免瞬间跳变，稍微 lerp 一下)
    // 但为了节奏感，不需要太慢
    
    // 填充 dataArray
    // 性能优化：只填充关键频段，不需要复杂的数学运算
    for(let i = 0; i < dataArray.length; i++) {
        let val = 0;
        
        // 简单的频谱分布模拟
        if (i < 50) val = 255 * currentSimulatedVolume; // 低频满
        else if (i < 200) val = 150 * currentSimulatedVolume; // 中频
        else val = 50 * currentSimulatedVolume; // 高频
        
        // 加一点点随机噪点，避免死板
        val += (Math.random() - 0.5) * 20;
        
        dataArray[i] = Math.max(0, Math.min(255, val));
    }
    
    // 返回是否是强音 (burst)
    return currentSimulatedVolume > 0.6;
}

function animate() {
    requestAnimationFrame(animate);
    
    // 更新动画混合器
    const delta = clock.getDelta();
    if (mixer) {
        mixer.update(delta);
    }
    
    // --- 音频分析逻辑 ---
    let level = 0;
    let bassLevel = 0;
    let trebleLevel = 0;
    let spectralColor = new THREE.Color(0x00ffff); // 默认青色

    // 1. 获取音频数据
    let isBurst = false;
    if (isAudioStarted) {
        if (IS_DEMO) {
            isBurst = simulateAudioData();
        } else if (analyser) {
            analyser.getByteFrequencyData(dataArray);
        }
        
        // 2. 计算总音量 Level
        let sum = 0;
        let bassSum = 0;
        let trebleSum = 0;
        
        // Bass range: bins 0-10 (approx 0-200Hz)
        // Treble range: bins 100-300 (approx 2kHz-6kHz)
        
        for(let i = 0; i < dataArray.length; i++) {
            let val = dataArray[i];
            sum += val;
            
            if (i < 20) bassSum += val;
            if (i > 100 && i < 300) trebleSum += val;
        }
        
        level = (sum / dataArray.length) / 255.0; 
        
        // 应用灵敏度增强 (仅在非演示模式下，或者都应用)
        // 演示模式生成的数据已经是全幅的，不需要增强
        if (!IS_DEMO) {
            level *= CONFIG.sensitivity;
            level = Math.min(1.0, level); // 限制最大值
        }
        
        // 归一化 Bass/Treble
        bassLevel = (bassSum / 20) / 255.0;
        trebleLevel = (trebleSum / 200) / 255.0;
        
        if (!IS_DEMO) {
            bassLevel = Math.min(1.0, bassLevel * CONFIG.sensitivity);
            trebleLevel = Math.min(1.0, trebleLevel * CONFIG.sensitivity);
        }
        
        // 3. 计算基于频谱的特殊颜色编码
        if (level > 0.01) {
             // 演示模式下简单模拟颜色变化
             if (IS_DEMO) {
                 spectralColor.setHSL(0.5 + Math.sin(time) * 0.2, 1.0, 0.6);
             } else {
                 spectralColor = getSpectralColor(dataArray);
             }
        }
    }

    // 目标凝聚度计算：
    // 音量越高 (level -> 1)，越凝聚 (cohesion -> 1)
    // 音量越低 (level -> 0)，越离散 (cohesion -> 0)
    
    // Demo 模式下，强制提高凝聚度的基准，让马看起来更完整
    // 修正：现在我们有了叙事循环，需要让马在静默期真正消散
    // 所以只在非静默期才强制凝聚
    let baseLevel = level;
    if (IS_DEMO) {
        // 直接使用 level，因为 simulateAudioData 已经处理好了逻辑
        // 不需要额外的强制修正
        baseLevel = level;
    }
    
    let targetCohesion = Math.min(1.0, baseLevel * 5.0); 
    
    // 平滑插值 (Asymmetric Lerp)
    // Attack (变凝聚/有声音): 快速 (0.2)
    // Release (变离散/没声音): 慢速 (0.01) -> 延迟增加 Noise
    
    if (targetCohesion > cohesionFactor) {
        // 音量变大，快速响应
        cohesionFactor += (targetCohesion - cohesionFactor) * 0.2;
    } else {
        // 音量变小，缓慢恢复到躁动状态 (延迟效果)
        cohesionFactor += (targetCohesion - cohesionFactor) * 0.01;
    }
    
    // 传递给 Shader 的是 chaosFactor (离散因子)
    // chaos = 1.0 - cohesion
    // 所以：静音 -> cohesion=0 -> chaos=1 (大躁动)
    //       声音 -> cohesion=1 -> chaos=0 (无躁动)
    let chaosFactor = 1.0 - cohesionFactor;
    
    time += 0.01;

let scaleState = 'normal'; // normal, growing, shrinking
let scaleTimer = 0;
let targetRandomScale = 0.3; // 目标随机缩放值

// ...

    // 更新主体马 Uniforms
    if (horseMesh && horseMesh.material && horseMesh.material.userData.uniforms) {
        horseMesh.material.userData.uniforms.time.value = time;
        horseMesh.material.userData.uniforms.chaosFactor.value = chaosFactor;
        
        // 1. 颜色变化
        let targetColor = new THREE.Color(0xffffff);
        horseMesh.material.color.lerp(targetColor, 0.1);
        
        // 2. 身材比例变化：移除随机缩放，恢复稳定逻辑
        // 静音 (level=0) -> scale = 0.3
        // 有声音 (level=1) -> scale = 0.15 (收缩)
        
        let targetScale = 0.3 - level * 0.15; // 0.3 -> 0.15
        targetScale = Math.max(0.1, targetScale);
        
        let currentScale = horseMesh.scale.x;
        // 使用平滑插值过渡
        let newScale = THREE.MathUtils.lerp(currentScale, targetScale, 0.1);
        horseMesh.scale.setScalar(newScale);
        
    }

    // 镜头动画：自主非线性旋转逻辑
    // 目标：隔一段时间自动大幅度摆动，平时缓慢游走
    
    // 初始化状态变量 (如果不存在)
    if (typeof window.cameraState === 'undefined') {
        window.cameraState = {
            angle: Math.PI / 2, // 初始角度 (90度，正前)
            targetAngle: Math.PI / 2,
            lastSwitchTime: 0,
            mode: 'idle' // 'idle' (慢速), 'swing' (大幅摆动)
        };
    }
    
    const cs = window.cameraState;
    
    // 1. 状态切换逻辑
    // Demo 模式下，直接在 simulateAudioData 里处理切换，这里只处理非 Demo 模式
    if (!IS_DEMO) {
        // 每隔 3-5 秒尝试切换一次目标角度
        if (time - cs.lastSwitchTime > 3.0 + Math.random() * 2.0) {
            cs.lastSwitchTime = time;
            
            // 随机决定是继续 idle 还是大幅 swing
            if (Math.random() < 0.3) {
                cs.mode = 'swing';
                cs.targetAngle = Math.random() * Math.PI * 2;
            } else {
                cs.mode = 'idle';
                cs.targetAngle = cs.angle + (Math.random() - 0.5) * 0.7;
            }
        }
    }
    
    // 2. 角度平滑更新 (非线性)
    // swing 模式快一点，idle 模式慢一点
    let lerpSpeed = (cs.mode === 'swing') ? 0.02 : 0.005;
    
    // 如果有声音 (level > 0.05)，稍微加快一点反应速度，增加活跃感
    if (level > 0.05) {
        lerpSpeed *= 1.5;
    }
    
    // 使用平滑阻尼
    cs.angle += (cs.targetAngle - cs.angle) * lerpSpeed;
    
    // 3. 应用角度
    // 直接使用 cs.angle，不再叠加 currentOrbitAngle
    let constrainedAngle = cs.angle;
    
    // 移除强制修正逻辑，允许自由旋转
    /*
    if (constrainedAngle < Math.PI/4) constrainedAngle = Math.PI/4;
    if (constrainedAngle > 3*Math.PI/4) constrainedAngle = 3*Math.PI/4;
    */
    
    // 4. 马的同步旋转
    // 让马也跟随这个自主节奏缓慢转动
    if (horseMesh) {
         const angleOffset = constrainedAngle - Math.PI/2;
         // 平滑跟随
         horseMesh.rotation.z = THREE.MathUtils.lerp(horseMesh.rotation.z, angleOffset * 0.3, 0.05);
    }
    
    // 2. 垂直角度 (Elevation)
    let elevation = Math.sin(time * 0.15) * 0.5; 
    
    // 3. 距离
    let distance = 300 - level * 50;
    
    // 4. 计算相机位置
    camera.position.x = distance * Math.cos(elevation) * Math.sin(constrainedAngle);
    camera.position.z = distance * Math.cos(elevation) * Math.cos(constrainedAngle);
    // 确保 Z 始终为正 (在马的前面)
    camera.position.z = Math.abs(camera.position.z);
    
    camera.position.y = distance * Math.sin(elevation);
    
    // 5. 始终看向中心 (马的位置)
    camera.lookAt(0, 0, 0);
    
    // 旋转相机自身的 Z 轴，增加一点“太空失重感”
    // 随时间缓慢旋转
    camera.up.set(Math.sin(time * 0.05), 1, 0).normalize();

    // 环境粒子微动
    // 让环境粒子跟随马一起旋转，创造整体空间感
    if (ambientParticles) {
        // 缓慢旋转，方向与马奔跑方向相反
        ambientParticles.rotation.y -= 0.0005;
        
        // 如果想让粒子跟随马头摆动，可以加上 currentOrbitAngle 的影响
        // ambientParticles.rotation.y = -currentOrbitAngle * 0.2;
    }

    // 6. 更新音频环 - 替换为更新流线
    // updateRings(); // 已移除
    
    // 计算马尾巴的世界坐标 (每一帧都计算) -> 改为固定位置
    // 抬升路的位置：Y 坐标从 -30 提高到 -10 (或者更接近马的中心 0)
    let tailPos = new THREE.Vector3(0, -10, -20); // 提高高度，让路看起来更贴近马蹄
    
    // 如果想要跟随马的整体移动（如果有的话），可以用 horseMesh.position
    // 但目前马是固定在中心的，所以直接用固定坐标即可
    
    // 之前复杂的顶点查找逻辑已移除
    /*
    if (horseMesh && tailVertexIndex !== -1) {
         // ...
    }
    */

    updateStreamlines(level, tailPos);
    
    // 7. 更新几何图案雨
    // 传入固定发射点 tailPos
    updateGeometricRain(level, bassLevel, trebleLevel, tailPos);

    /* 移除旧的触发逻辑，因为流线是连续更新的
    if (level > 0.05) { 
         // ...
        emitRingPulse(...);
    }
    */

    renderer.render(scene, camera);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function addOverlayText() {
    // 简单提示，不再需要点击交互
    const div = document.createElement('div');
    div.id = 'overlay-text';
    div.style.position = 'absolute';
    div.style.top = '10%';
    div.style.left = '50%';
    div.style.transform = 'translate(-50%, 0)';
    div.style.color = '#666';
    div.style.fontFamily = 'serif';
    div.style.fontSize = '14px';
    div.style.textAlign = 'center';
    div.style.pointerEvents = 'none';
    div.innerHTML = 'THE REAL STEED // ANIMATION TEST';
    document.body.appendChild(div);
}

// 启动
init();