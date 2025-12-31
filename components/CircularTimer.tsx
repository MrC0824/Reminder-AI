
import React, { useEffect, useState } from 'react';
import { getTimeComponents, formatFullDateTime } from '@/utils/timeUtils';

interface CircularTimerProps {
  timeLeft: number;
  totalTime: number;
  status: string;
}

const CircularTimer: React.FC<CircularTimerProps> = ({ timeLeft, totalTime, status }) => {
  const radius = 130; // 稍微增大尺寸以容纳更多信息
  const stroke = 8;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  
  const progress = totalTime > 0 ? timeLeft / totalTime : 0;
  const strokeDashoffset = circumference - progress * circumference;

  // 动态计算目标时间 (ETA)
  // 如果正在运行，ETA = 当前时间 + 剩余时间
  // 如果暂停或空闲，ETA = "目标" (假设立即开始)
  const [etaText, setEtaText] = useState('');

  useEffect(() => {
    const targetTimestamp = Date.now() + timeLeft * 1000;
    setEtaText(formatFullDateTime(targetTimestamp));
  }, [timeLeft]);

  // 颜色逻辑
  let strokeColor = 'stroke-blue-500';
  let shadowColor = 'shadow-blue-500/20';
  
  if (status === 'waiting') {
      strokeColor = 'stroke-indigo-400';
      shadowColor = 'shadow-indigo-500/20';
  } else if (status === 'paused') {
      strokeColor = 'stroke-slate-400';
      shadowColor = 'shadow-slate-500/20';
  } else if (status === 'alert_active') {
      strokeColor = 'stroke-emerald-500';
      shadowColor = 'shadow-emerald-500/20';
  } else if (timeLeft < 60 && status === 'running') {
      strokeColor = 'stroke-rose-500';
      shadowColor = 'shadow-rose-500/30';
  } else if (timeLeft < totalTime * 0.25 && status === 'running') {
      strokeColor = 'stroke-amber-500';
      shadowColor = 'shadow-amber-500/20';
  }

  const getStatusText = (s: string) => {
    switch(s) {
      case 'idle': return '已就绪';
      case 'running': return '运行中';
      case 'paused': return '已暂停';
      case 'waiting': return '等待中';
      case 'alert_active': return '待确认';
      default: return s;
    }
  };

  const { d, h, m, s } = getTimeComponents(timeLeft);
  // 将天数折算进小时显示，确保总时长信息不丢失
  const totalHours = d * 24 + h;
  const hStr = totalHours.toString().padStart(2, '0');
  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toString().padStart(2, '0');
  const timeString = `${hStr}:${mStr}:${sStr}`;

  // 动态调整字号以适应超长时数（避免贴边）
  let fontSizeClass = 'text-5xl'; // 默认 2 位小时
  if (hStr.length >= 5) {
      fontSizeClass = 'text-2xl'; // 5 位小时及以上
  } else if (hStr.length >= 4) {
      fontSizeClass = 'text-3xl'; // 4 位小时 (如 1666:xx:xx)
  } else if (hStr.length >= 3) {
      fontSizeClass = 'text-4xl'; // 3 位小时
  }

  return (
    <div className="relative flex items-center justify-center p-6">
      {/* 外部装饰光晕 */}
      <div className={`absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-transparent to-white/50 dark:to-white/5 opacity-0 dark:opacity-100 pointer-events-none`}></div>
      
      <svg
        height={radius * 2}
        width={radius * 2}
        className="rotate-[-90deg] transition-all duration-500 relative z-10"
        style={{ filter: `drop-shadow(0 0 10px rgba(0,0,0,0.05))` }}
      >
        {/* 轨道背景 */}
        <circle
          stroke="currentColor"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          className="text-slate-100 dark:text-slate-800 transition-colors duration-300"
        />
        {/* 进度条 */}
        <circle
          stroke="currentColor"
          fill="transparent"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference + ' ' + circumference}
          style={{ strokeDashoffset }}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          className={`${strokeColor} transition-all duration-1000 ease-linear`}
        />
      </svg>

      {/* 中心内容容器 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
        
        {/* 顶部：始终显示状态文字 */}
        <div className="mb-2 flex flex-col items-center justify-center h-8">
            <span className={`text-[10px] font-bold tracking-[0.2em] uppercase py-0.5 px-2 rounded-full border ${status === 'running' ? 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800' : 'bg-slate-50 text-slate-400 border-slate-100 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'}`}>
                {getStatusText(status)}
            </span>
        </div>

        {/* 中间：大号倒计时 (使用动态字号) */}
        <div className="relative w-full text-center px-4">
            <span className={`${fontSizeClass} font-bold font-mono tabular-nums tracking-tight leading-none text-slate-800 dark:text-slate-100 transition-all duration-300 ${status === 'paused' ? 'opacity-50' : 'opacity-100'}`}>
            {timeString}
            </span>
        </div>

        {/* 底部：目标时间 (包含完整的年月日时分秒) */}
        <div className="mt-4 flex flex-col items-center opacity-80 group cursor-default">
            <span className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">目标时间</span>
            <span className="text-xs font-mono font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                {etaText.split(' ')[0]} {/* YYYY/MM/DD */}
            </span>
            <span className="text-xs font-mono font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                {etaText.split(' ')[1]} {/* HH:MM:SS */}
            </span>
        </div>

      </div>
    </div>
  );
};

export default CircularTimer;
