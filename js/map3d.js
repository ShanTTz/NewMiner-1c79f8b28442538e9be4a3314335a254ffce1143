import state from './state.js';
import { invalidateMap, ensureMapOpen } from './map2d.js';

let my3DChart = null;
let is3DInitialized = false;
let simplex = null;

export function init3DModel() {
    const chartDom = document.getElementById('echarts-main');
    // 确保容器有尺寸
    if (chartDom.clientHeight === 0) {
        chartDom.style.height = '100%';
    }
    
    if (!my3DChart) {
        my3DChart = echarts.init(chartDom);
    }
    
    if (!simplex) {
        simplex = new SimplexNoise();
    }

    // 初始化时尝试渲染当前状态的数据，如果没有数据则显示默认空场景
    update3DData();
    is3DInitialized = true;
}

/**
 * 核心：根据 state.lastHostData 动态更新 3D 场景
 * 支持：自动计算经纬度中心、生成动态地形、绘制靶区/钻孔/异常
 */
export function update3DData(directData = null) {
    if (!my3DChart) return;

    const data = directData || state.lastHostData;

    // 如果没有数据，渲染一个基础的空场景
    if (!data) {
        renderDefaultScene();
        return;
    }

    // 1. 计算数据的地理边界 (Bounding Box)
    const bounds = calculateBounds(data);
    const { minLng, maxLng, minLat, maxLat } = bounds;

    // 2. 基于当前经纬度范围生成地形数据
    const terrainData = generateDynamicTerrain(minLng, maxLng, minLat, maxLat);

    // 3. 构建数据序列 (Series)
    const seriesList = [];

    // --- Series A: 地形曲面 ---
    seriesList.push({
        type: 'surface',
        name: '地形',
        data: terrainData,
        shading: 'lambert',
        itemStyle: { color: '#e6c88c', opacity: 0.6 },
        wireframe: { show: true, lineStyle: { width: 0.5, color: 'rgba(0,0,0,0.1)' } },
        silent: true // 地形不响应鼠标事件，以免遮挡数据
    });

    // --- Series B: 预测靶区 (红色线条) ---
    if (data.target_area && Array.isArray(data.target_area) && data.target_area.length > 0) {
        // 构造闭合的多边形线条，Z轴设为 100m 悬浮
        const lineData = data.target_area.map(p => [p[1], p[0], 100]); // [lng, lat, z]
        if (lineData.length > 0) {
            lineData.push(lineData[0]); // 闭合回路
        }

        seriesList.push({
            type: 'line3D',
            name: '预测靶区',
            data: lineData,
            lineStyle: {
                width: 5,
                color: '#ff0000',
                opacity: 1
            }
        });
    }

    // --- Series C: 钻孔点位 (红色立柱) ---
    if (data.drill_sites && Array.isArray(data.drill_sites)) {
        const drillData = data.drill_sites
            .filter(d => d.lat && d.lng) // 过滤无效数据
            .map(d => ({
                name: d.id || '钻孔',
                value: [d.lng, d.lat, 150, d.reason, d.depth] // Z=150
            }));

        if (drillData.length > 0) {
            seriesList.push({
                type: 'scatter3D',
                name: '建议钻孔',
                data: drillData,
                symbol: 'pin', // 大头针样式
                symbolSize: 24,
                itemStyle: { color: '#d73027', opacity: 1 },
                label: {
                    show: true,
                    formatter: '{b}',
                    textStyle: { color: 'black', backgroundColor: 'white', padding: 3, borderRadius: 3 }
                },
                emphasis: {
                    label: { show: true, formatter: p => `${p.name}\n深度:${p.value[4]}\n${p.value[3]}` }
                }
            });
        }
    }
    
    // --- Series D: 物探异常 (蓝色球体) ---
    if (data.geo_anomalies && Array.isArray(data.geo_anomalies)) {
        const geoData = data.geo_anomalies
            .filter(a => a.lat && a.lng)
            .map(a => [a.lng, a.lat, 50, a.type, a.value, a.desc]); // Z=50 贴近地面

        if (geoData.length > 0) {
            seriesList.push({
                type: 'scatter3D',
                name: '物探异常',
                data: geoData,
                symbol: 'circle',
                symbolSize: 12,
                itemStyle: { color: '#313695', opacity: 0.8 },
                emphasis: {
                    label: { show: true, formatter: p => `[物探] ${p.value[3]}\n值: ${p.value[4]}` }
                }
            });
        }
    }

    // --- Series E: 化探异常 (绿色菱形) ---
    if (data.chem_anomalies && Array.isArray(data.chem_anomalies)) {
        const chemData = data.chem_anomalies
            .filter(a => a.lat && a.lng)
            .map(a => [a.lng, a.lat, 50, a.type, a.value, a.desc]);

        if (chemData.length > 0) {
            seriesList.push({
                type: 'scatter3D',
                name: '化探异常',
                data: chemData,
                symbol: 'diamond',
                symbolSize: 14,
                itemStyle: { color: '#66bd63', opacity: 0.9 },
                emphasis: {
                    label: { show: true, formatter: p => `[化探] ${p.value[3]}\n值: ${p.value[4]}` }
                }
            });
        }
    }

    // 4. 配置项更新
    const option = {
        tooltip: { show: true },
        grid3D: {
            boxWidth: 200,
            boxDepth: 200, // 保持长宽比
            boxHeight: 50,
            environment: 'auto', // 自动背景
            light: {
                main: { intensity: 1.2, shadow: true, alpha: 50, beta: -30 },
                ambient: { intensity: 0.6 }
            },
            viewControl: {
                autoRotate: false,
                projection: 'perspective',
                distance: 280,
                center: [0, 0, 0],
                panMouseButton: 'right',
                rotateMouseButton: 'left'
            }
        },
        // 坐标轴改为经纬度
        xAxis3D: { 
            name: 'Longitude', 
            min: minLng, max: maxLng, 
            axisLabel: { formatter: val => val.toFixed(3) } 
        },
        yAxis3D: { 
            name: 'Latitude', 
            min: minLat, max: maxLat, 
            axisLabel: { formatter: val => val.toFixed(3) } 
        },
        zAxis3D: { 
            name: 'Elevation (m)', 
            min: -500, max: 500 
        },
        series: seriesList
    };

    my3DChart.setOption(option, true); // true 表示不合并，完全重绘
}

// 辅助：计算动态边界
function calculateBounds(data) {
    let lats = [];
    let lngs = [];

    // 收集所有出现的坐标点
    const collect = (arr, latKey, lngKey) => {
        if (arr && Array.isArray(arr)) {
            arr.forEach(item => {
                // 处理数组形式 [lat, lng] 或 对象形式 {lat:..., lng:...}
                let lat, lng;
                if (Array.isArray(item)) { lat = item[0]; lng = item[1]; }
                else { lat = item[latKey]; lng = item[lngKey]; }
                
                if (lat && lng) { lats.push(parseFloat(lat)); lngs.push(parseFloat(lng)); }
            });
        }
    };

    collect(data.target_area, 0, 1); // target_area 是 [[lat,lng],...]
    collect(data.drill_sites, 'lat', 'lng');
    collect(data.geo_anomalies, 'lat', 'lng');
    collect(data.chem_anomalies, 'lat', 'lng');
    
    // 如果没有任何坐标，默认显示北京周边
    if (lats.length === 0) {
        return { minLng: 116.35, maxLng: 116.45, minLat: 39.85, maxLat: 39.95 };
    }

    const minLatVal = Math.min(...lats);
    const maxLatVal = Math.max(...lats);
    const minLngVal = Math.min(...lngs);
    const maxLngVal = Math.max(...lngs);

    // 计算跨度并增加 20% 边距，防止图形顶到边缘
    const latSpan = Math.max(maxLatVal - minLatVal, 0.01); // 最小跨度 0.01 度
    const lngSpan = Math.max(maxLngVal - minLngVal, 0.01);

    return {
        minLat: minLatVal - latSpan * 0.5,
        maxLat: maxLatVal + latSpan * 0.5,
        minLng: minLngVal - lngSpan * 0.5,
        maxLng: maxLngVal + lngSpan * 0.5
    };
}

// 辅助：基于经纬度的地形生成
function generateDynamicTerrain(minLng, maxLng, minLat, maxLat) {
    const data = [];
    const segments = 60; // 60x60 的网格
    const lngStep = (maxLng - minLng) / segments;
    const latStep = (maxLat - minLat) / segments;

    // 缩放因子：为了让 SimplexNoise 在微小的经纬度变化下产生波浪，需要放大输入坐标
    // 经纬度差 0.01 度 对应 约 1km。SimplexNoise 周期通常在 1.0 左右。
    const noiseScale = 3000; 

    for (let x = 0; x <= segments; x++) {
        for (let y = 0; y <= segments; y++) {
            const lng = minLng + x * lngStep;
            const lat = minLat + y * latStep;
            
            // 噪声生成高度 (Z)
            const noise = simplex.noise2D(lng * 100, lat * 100) * 200; 
            const baseHeight = -100; 
            
            data.push([lng, lat, noise + baseHeight]);
        }
    }
    return data;
}

// 辅助：渲染默认空场景（无数据时显示）
function renderDefaultScene() {
    const option = {
        grid3D: { boxHeight: 20 },
        xAxis3D: { name: 'Longitude' },
        yAxis3D: { name: 'Latitude' },
        zAxis3D: { name: 'Elev' },
        series: [{
            type: 'surface',
            data: [],
            itemStyle: { color: '#eee' }
        }],
        graphic: [{
            type: 'text',
            left: 'center',
            top: 'middle',
            style: {
                text: '暂无 3D 数据\n请先在左侧对话框中生成预测结果',
                font: '16px sans-serif',
                fill: '#999'
            }
        }]
    };
    my3DChart.setOption(option, true);
}

export function switchViewMode(mode) {
    state.currentViewMode = mode;
    ensureMapOpen();

    const mapEl = document.getElementById('map');
    const echartsEl = document.getElementById('echarts-main');
    const ctrl3d = document.getElementById('ctrl-panel-3d');
    const btn2d = document.getElementById('btn-2d');
    const btn3d = document.getElementById('btn-3d');

    if (mode === '2d') {
        mapEl.style.display = 'block';
        echartsEl.style.display = 'none';
        ctrl3d.style.display = 'none';
        btn2d.classList.add('active');
        btn3d.classList.remove('active');
        invalidateMap();
    } else {
        mapEl.style.display = 'block'; 
        echartsEl.style.display = 'block';
        ctrl3d.style.display = 'block';
        btn2d.classList.remove('active');
        btn3d.classList.add('active');
        
        if (!is3DInitialized) {
            init3DModel();
        } else {
            // 每次切换回 3D，尝试根据当前 state 刷新数据
            update3DData(); 
            resize3D();
        }
    }
}

export function resize3D() {
    if (my3DChart) my3DChart.resize();
}