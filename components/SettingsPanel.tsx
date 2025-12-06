
import React, { useRef, useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { generateId, formatDateTime, formatTime } from '@/utils/timeUtils';
import { CustomReminder, IntervalUnit, ReminderType, AppSettings, WorkMode } from '@/types';

// Helper to access IPC
const ipcRenderer = typeof window !== 'undefined' && (window as any).require ? (window as any).require('electron').ipcRenderer : null;

// Helper to get current local time in ISO format for input min attribute
const getCurrentLocalISO = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const SettingsPanel: React.FC = () => {
  const { 
      settings, 
      updateSettings, 
      handleAudioUpload, 
      deleteCustomAudio, 
      selectAudio, 
      previewAudio, 
      stopPreviewAudio, 
      previewingId,
      customTimersStatus,
      checkUpdates,
      updateStatus
  } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // State for new/edit reminder form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newReminderTitle, setNewReminderTitle] = useState('');
  const [newReminderType, setNewReminderType] = useState<ReminderType>('interval');
  const [newReminderValue, setNewReminderValue] = useState<number | ''>(''); 
  const [newReminderUnit, setNewReminderUnit] = useState<IntervalUnit>('minutes');
  const [newReminderDateTime, setNewReminderDateTime] = useState('');
  const [minDateTime, setMinDateTime] = useState(getCurrentLocalISO);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  // Initial version state is empty, to be fetched dynamically
  const [appVersion, setAppVersion] = useState('');

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    return () => {
        const ranges = settingsRef.current.activeHoursRanges;
        const cleaned = ranges.filter(r => r.start.trim() !== '' && r.end.trim() !== '');
        if (cleaned.length !== ranges.length) {
            updateSettings({ activeHoursRanges: cleaned });
        }
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => { setMinDateTime(getCurrentLocalISO()); }, 60000); 
    return () => clearInterval(interval);
  }, []);

  // Fetch version from main process
  useEffect(() => {
      if (ipcRenderer) {
          ipcRenderer.invoke('get-app-version')
            .then((ver: string) => setAppVersion(ver))
            .catch((err: any) => console.warn('Failed to get app version:', err));
      }
  }, []);
  
  const handleDateFocus = () => { setMinDateTime(getCurrentLocalISO()); };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let finalValue: any = value;

    if (type === 'checkbox') {
      finalValue = (e.target as HTMLInputElement).checked;
    } else if (type === 'number') {
      finalValue = value === '' ? '' : Number(value);
    } else if (type === 'range') {
      finalValue = Number(value);
    }

    if (name === 'intervalValue') {
        if (finalValue !== '') {
             if (finalValue < 1) finalValue = 1;
             if (finalValue > 99999) finalValue = 99999;
        }
        updateSettings({ [name]: finalValue } as Partial<AppSettings>);
    } 
    else if (name === 'intervalUnit') {
        updateSettings({ [name]: value as IntervalUnit });
    } 
    else {
        updateSettings({ [name]: finalValue } as Partial<AppSettings>);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        handleAudioUpload(e.target.files[0]);
        e.target.value = '';
    }
  };

  const startEditing = (id: string) => {
      const r = settings.customReminders.find(item => item.id === id);
      if (!r) return;
      setEditingId(id);
      setNewReminderTitle(r.title);
      setNewReminderType(r.type);
      setAlertMsg(null);
      if (r.type === 'interval') {
          setNewReminderValue(r.intervalValue ?? '');
          setNewReminderUnit(r.intervalUnit ?? 'minutes');
          setNewReminderDateTime(''); 
      } else {
          setNewReminderValue('');
          if (r.targetDateTime) {
              const d = new Date(r.targetDateTime);
              const Y = d.getFullYear();
              const M = (d.getMonth()+1).toString().padStart(2, '0');
              const D = d.getDate().toString().padStart(2, '0');
              const h = d.getHours().toString().padStart(2, '0');
              const m = d.getMinutes().toString().padStart(2, '0');
              setNewReminderDateTime(`${Y}-${M}-${D}T${h}:${m}`);
          } else {
              setNewReminderDateTime('');
          }
      }
  };

  const cancelEdit = () => {
      setEditingId(null);
      setNewReminderTitle('');
      setNewReminderValue('');
      setNewReminderDateTime('');
      setNewReminderType('interval');
      setAlertMsg(null);
  };

  const saveCustomReminder = () => {
      setAlertMsg(null);
      if (!newReminderTitle.trim()) return;
      
      let targetTime: number | undefined;
      const intervalVal = newReminderValue === '' ? 0 : newReminderValue;

      if (newReminderType === 'onetime') {
          if (!newReminderDateTime) return;
          targetTime = new Date(newReminderDateTime).getTime();
          if (targetTime < Date.now()) {
              setAlertMsg('请选择一个未来的时间');
              return;
          }
      } else {
          if (intervalVal <= 0) {
              setAlertMsg('间隔时间必须大于0');
              return;
          }
      }

      if (editingId) {
          const updatedReminders = settings.customReminders.map(r => {
              if (r.id === editingId) {
                  return {
                      ...r,
                      title: newReminderTitle,
                      type: newReminderType,
                      intervalValue: newReminderType === 'interval' ? intervalVal : undefined,
                      intervalUnit: newReminderType === 'interval' ? newReminderUnit : undefined,
                      targetDateTime: targetTime,
                      enabled: true 
                  };
              }
              return r;
          });
          updateSettings({ customReminders: updatedReminders });
          cancelEdit();
      } else {
          const newReminder: CustomReminder = {
              id: generateId(),
              title: newReminderTitle,
              type: newReminderType,
              enabled: true,
              intervalValue: newReminderType === 'interval' ? intervalVal : undefined,
              intervalUnit: newReminderType === 'interval' ? newReminderUnit : undefined,
              targetDateTime: targetTime
          };
          updateSettings({ customReminders: [...settings.customReminders, newReminder] });
          setNewReminderTitle('');
          setNewReminderValue('');
          setNewReminderDateTime('');
          setAlertMsg(null);
      }
  };

  const deleteCustomReminder = (id: string) => {
      if (id === editingId) cancelEdit();
      updateSettings({ customReminders: settings.customReminders.filter(r => r.id !== id) });
  };
  
  const toggleCustomReminder = (id: string) => {
       const reminder = settings.customReminders.find(r => r.id === id);
       if (!reminder) return;
       if (!reminder.enabled) {
           if (reminder.type === 'onetime' && reminder.targetDateTime) {
               if (reminder.targetDateTime <= Date.now()) {
                   updateSettings({ customReminders: settings.customReminders.filter(r => r.id !== id) });
                   return;
               }
           }
       }
       updateSettings({
          customReminders: settings.customReminders.map(r => 
            r.id === id ? { ...r, enabled: !r.enabled } : r
          )
      });
  };

  // --- Active Hours Range Handlers ---
  const addTimeRange = () => {
    const newRange = { id: generateId(), start: '', end: '' };
    updateSettings({ activeHoursRanges: [...settings.activeHoursRanges, newRange] });
  };

  const removeTimeRange = (id: string) => {
    const updatedRanges = settings.activeHoursRanges.filter(range => range.id !== id);
    updateSettings({ activeHoursRanges: updatedRanges });
  };

  const updateTimeRange = (id: string, field: 'start' | 'end', value: string) => {
    const updatedRanges = settings.activeHoursRanges.map(range => 
        range.id === id ? { ...range, [field]: value } : range
    );
    updateSettings({ activeHoursRanges: updatedRanges });
  };
  
  // Shortcut Recording
  const [isRecording, setIsRecording] = useState(false);
  const shortcutInputRef = useRef<HTMLInputElement>(null);
  const ignoreBlurRef = useRef(false);

  // Focus management effect
  useEffect(() => {
    if (isRecording) {
        shortcutInputRef.current?.focus();
        
        // Keep lock active for a short while to prevent immediate blur
        const timer = setTimeout(() => {
            ignoreBlurRef.current = false;
        }, 300);
        return () => clearTimeout(timer);
    }
  }, [isRecording]);

  const handleShortcutKeyDown = (e: React.KeyboardEvent) => {
      if (!isRecording) return;
      e.preventDefault();

      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');
      if (e.metaKey) keys.push('Super'); // Electron uses Super or Command

      // Ignore isolated modifier presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      
      // Map keys to Electron Accelerator format if needed, but basic keys usually work
      let key = e.key.toUpperCase();
      // Handle special cases if necessary, but keep it simple for now
      if (key === ' ') key = 'Space';
      
      keys.push(key);
      const shortcutStr = keys.join('+');
      
      updateSettings({ globalShortcut: shortcutStr });
      setIsRecording(false);
  };
  
  const clearShortcut = () => {
      updateSettings({ globalShortcut: '' });
      setIsRecording(false);
  };

  const themes = [
      { id: 'light', name: '浅色模式', icon: '☀️' },
      { id: 'dark', name: '深色模式', icon: '🌙' }
  ];

  const workModes: {id: WorkMode, label: string}[] = [
      { id: 'everyday', label: '每天' },
      { id: 'big-small', label: '大小周' },
      { id: 'weekend', label: '周末' },
  ];

  return (
    <>
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-200 dark:border-slate-700/50 h-full flex flex-col overflow-hidden transition-colors duration-300">
        <div className="p-6 border-b border-gray-200 dark:border-slate-700/50 bg-white dark:bg-slate-800 flex-shrink-0 transition-colors duration-300 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <span>⚙️</span> 参数配置
            </h2>
            <div className="flex items-center gap-3">
                 {/* Update Status Feedback */}
                 {ipcRenderer && updateStatus === 'checking' && (
                     <span className="text-xs text-slate-500 animate-pulse">正在检查...</span>
                 )}
                 {ipcRenderer && updateStatus === 'not-available' && (
                     <span className="text-xs text-green-600 dark:text-green-400">已是最新版本</span>
                 )}
                 
                 {appVersion && (
                    <span className="text-xs text-slate-400 font-mono bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">{`v${appVersion}`}</span>
                 )}

                 {/* Check Update Button - Only visible in Electron */}
                 {ipcRenderer && (
                    <button 
                        onClick={() => checkUpdates(true)}
                        disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                        className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="检查更新"
                    >
                        <svg className={`w-4 h-4 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                 )}
            </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-8 pb-24">
            <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-700 pb-2">外观设置</label>
            <div className="flex gap-2">
                {themes.map(t => (
                    <button
                            key={t.id}
                            onClick={() => updateSettings({ theme: t.id as any })}
                            className={`flex-1 py-2 px-3 rounded-lg border flex items-center justify-center gap-2 text-sm transition-all ${
                                settings.theme === t.id 
                                ? 'bg-blue-50 border-blue-500 text-blue-600 dark:bg-blue-900/30 dark:border-blue-500 dark:text-blue-400' 
                                : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'
                            }`}
                    >
                        <span>{t.icon}</span>
                        <span>{t.name}</span>
                    </button>
                ))}
            </div>
            </div>
            
            {/* Global Shortcut Section */}
            {ipcRenderer && (
                <div className="space-y-4">
                    <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-700 pb-2">全局快捷键</label>
                    <div className="flex flex-col gap-2">
                         <span className="text-xs text-slate-500">一键显示/隐藏主界面 (即使应用在后台)</span>
                         <div className="flex gap-2">
                             <div className={`relative flex-1 bg-white dark:bg-slate-900 border rounded-lg flex items-center px-3 py-2 transition-colors ${isRecording ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-300 dark:border-slate-600'}`}>
                                 <input
                                    ref={shortcutInputRef}
                                    type="text"
                                    readOnly
                                    value={isRecording ? '请按下快捷键组合...' : (settings.globalShortcut || '未设置')}
                                    onKeyDown={handleShortcutKeyDown}
                                    onBlur={(e) => {
                                        if (ignoreBlurRef.current) {
                                            e.target.focus();
                                            return;
                                        }
                                        setIsRecording(false);
                                    }}
                                    className={`w-full bg-transparent outline-none text-sm cursor-default ${isRecording ? 'text-blue-500' : (settings.globalShortcut ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400')}`}
                                 />
                                 {settings.globalShortcut && !isRecording && (
                                     <button onClick={clearShortcut} className="ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                     </button>
                                 )}
                             </div>
                             {/* Wrapper to prevent blur when clicking disabled button */}
                             <div 
                                onMouseDown={(e) => isRecording && e.preventDefault()}
                             >
                                <button 
                                    onClick={() => {
                                        ignoreBlurRef.current = true;
                                        setIsRecording(true);
                                    }}
                                    disabled={isRecording}
                                    className={`h-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isRecording ? 'bg-gray-100 text-slate-500 pointer-events-none' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                                >
                                    {isRecording ? '录制中...' : (settings.globalShortcut ? '重新设置' : '设置快捷键')}
                                </button>
                             </div>
                         </div>
                    </div>
                </div>
            )}

            <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-700 pb-2">主提醒 (循环)</label>
            <div className="grid grid-cols-2 gap-4">
                <div>
                <label className="text-xs text-slate-500 mb-1 block">提醒间隔数值</label>
                <input
                    type="number"
                    name="intervalValue"
                    value={settings.intervalValue}
                    onChange={handleChange}
                    min="1"
                    max="99999"
                    className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                />
                </div>
                <div>
                    <label className="text-xs text-slate-500 mb-1 block">时间单位</label>
                    <select
                        name="intervalUnit"
                        value={settings.intervalUnit}
                        onChange={handleChange}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                    >
                        <option value="seconds">秒</option>
                        <option value="minutes">分钟</option>
                        <option value="hours">小时</option>
                    </select>
                </div>
            </div>

            <div className="flex flex-col gap-3 mt-2">
                <div>
                    <span className="text-xs text-slate-500 mb-1 block">文案前缀</span>
                    <input
                        type="text"
                        name="messagePrefix"
                        value={settings.messagePrefix}
                        onChange={handleChange}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                    />
                </div>
                <div>
                    <span className="text-xs text-slate-500 mb-1 block">文案后缀</span>
                    <input
                        type="text"
                        name="messageSuffix"
                        value={settings.messageSuffix}
                        onChange={handleChange}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                    />
                </div>
            </div>
            </div>

            <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-700 pb-2">自定义内容提醒</label>
            <div className="space-y-3">
                {settings.customReminders.map(reminder => {
                    const timerStatus = customTimersStatus.find(s => s.id === reminder.id);
                    return (
                        <div key={reminder.id} className={`flex items-center gap-3 bg-white dark:bg-slate-800 p-3 rounded-lg border shadow-sm transition-colors ${editingId === reminder.id ? 'border-blue-500' : 'border-gray-200 dark:border-slate-700/50'}`}>
                            <input 
                                    type="checkbox"
                                    checked={reminder.enabled}
                                    onChange={() => toggleCustomReminder(reminder.id)}
                                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{reminder.title}</div>
                                <div className="text-xs text-slate-500 mt-1 flex items-center flex-wrap gap-2">
                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${reminder.type === 'interval' ? 'bg-blue-50 border-blue-100 text-blue-600 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400' : 'bg-amber-50 border-amber-100 text-amber-600 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400'}`}>
                                        {reminder.type === 'interval' ? '🔄' : '📅'}
                                        <span>{reminder.type === 'interval' ? '周期' : '定点'}</span>
                                    </span>
                                    <span className="truncate max-w-[120px]">
                                        {reminder.type === 'interval' 
                                            ? `每 ${reminder.intervalValue} ${reminder.intervalUnit === 'hours' ? '小时' : (reminder.intervalUnit === 'seconds' ? '秒' : '分钟')}` 
                                            : (reminder.targetDateTime ? formatDateTime(reminder.targetDateTime) : 'N/A')}
                                    </span>
                                    {reminder.enabled && timerStatus && timerStatus.timeLeft > 0 && (
                                        <>
                                            <span className="text-gray-300 dark:text-slate-600">|</span>
                                            <span className={`font-mono font-bold text-xs truncate max-w-[80px] ${reminder.type === 'interval' ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                                剩 {formatTime(timerStatus.timeLeft)}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                    <button 
                                        onClick={() => startEditing(reminder.id)}
                                        className="text-blue-400 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 p-1 shrink-0 transition-colors"
                                        title="编辑"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                    </button>
                                    <button 
                                        onClick={() => deleteCustomReminder(reminder.id)}
                                        className="text-red-400 hover:text-red-500 dark:text-red-300 dark:hover:text-red-200 p-1 shrink-0 transition-colors"
                                        title="删除"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                            </div>
                        </div>
                    );
                })}

                <div className={`p-3 rounded-lg space-y-3 border transition-colors ${editingId ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800' : 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700'}`}>
                    {editingId && (
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">正在编辑:</span>
                            <button onClick={cancelEdit} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">取消</button>
                        </div>
                    )}
                    <div className="flex rounded-md bg-white dark:bg-slate-900 p-1 mb-2 border border-gray-200 dark:border-slate-700">
                        <button 
                            onClick={() => setNewReminderType('interval')}
                            className={`flex-1 py-1 text-xs rounded ${newReminderType === 'interval' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-500'}`}
                        >
                            周期提醒
                        </button>
                        <button 
                            onClick={() => setNewReminderType('onetime')}
                            className={`flex-1 py-1 text-xs rounded ${newReminderType === 'onetime' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-500'}`}
                        >
                            定点提醒
                        </button>
                    </div>
                    
                    <div>
                        <input 
                                type="text" 
                                placeholder="提醒内容 (支持 \n 换行)"
                                value={newReminderTitle}
                                onChange={(e) => setNewReminderTitle(e.target.value)}
                                className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-slate-800 dark:text-white"
                        />
                    </div>
                    
                    {newReminderType === 'interval' ? (
                        <div className="flex gap-2">
                            <input 
                                    type="number" 
                                    min="1"
                                    max="99999"
                                    placeholder="间隔时长"
                                    value={newReminderValue}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === '') {
                                            setNewReminderValue('');
                                        } else {
                                            let num = Number(val);
                                            if (num < 1) num = 1;
                                            if (num > 99999) num = 99999;
                                            setNewReminderValue(num);
                                        }
                                    }}
                                    className="flex-1 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-slate-800 dark:text-white"
                            />
                            <select 
                                value={newReminderUnit}
                                onChange={(e) => setNewReminderUnit(e.target.value as IntervalUnit)}
                                className="w-24 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-2 py-2 text-sm focus:outline-none focus:border-blue-500 text-slate-800 dark:text-white"
                            >
                                <option value="seconds">秒</option>
                                <option value="minutes">分钟</option>
                                <option value="hours">小时</option>
                            </select>
                            <button 
                                    onClick={saveCustomReminder}
                                    disabled={!newReminderTitle.trim() || newReminderValue === '' || Number(newReminderValue) <= 0}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {editingId ? '保存' : '添加'}
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <input 
                                    type="datetime-local"
                                    value={newReminderDateTime}
                                    onChange={(e) => setNewReminderDateTime(e.target.value)}
                                    onFocus={handleDateFocus}
                                    min={minDateTime}
                                    style={{ colorScheme: settings.theme === 'dark' ? 'dark' : 'light', accentColor: '#2563eb' }}
                                    className="flex-1 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-slate-800 dark:text-white"
                            />
                            <button 
                                    onClick={saveCustomReminder}
                                    disabled={!newReminderTitle.trim() || !newReminderDateTime}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {editingId ? '保存' : '添加'}
                            </button>
                        </div>
                    )}
                    {alertMsg && (
                         <div className="text-red-500 text-xs mt-1 animate-pulse">
                             ⚠️ {alertMsg}
                         </div>
                    )}
                </div>
            </div>
            </div>

            <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-700 pb-2">时段自启 (工作时段)</label>
            <div className="flex flex-col gap-3 bg-gray-50 dark:bg-slate-900/50 p-4 rounded-lg border border-gray-200 dark:border-slate-700/50">
                    <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                            <span className="text-slate-700 dark:text-slate-300 font-medium">启用时段限制</span>
                            <span className="text-xs text-slate-500 mt-1">仅在下列指定时间段内运行</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                                type="checkbox" 
                                name="activeHoursEnabled" 
                                checked={settings.activeHoursEnabled} 
                                onChange={handleChange} 
                                className="sr-only peer" 
                            />
                            <div className="w-11 h-6 bg-gray-300 dark:bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    {settings.activeHoursEnabled && (
                        <div className="pt-2 border-t border-gray-200 dark:border-slate-700/50 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block">工作模式</label>
                                <select
                                    value={settings.workMode}
                                    onChange={(e) => updateSettings({ workMode: e.target.value as WorkMode })}
                                    className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                                >
                                    {workModes.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            </div>
                            
                            <div className="flex items-center justify-between pt-5">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input 
                                        type="checkbox"
                                        checked={settings.skipHolidays}
                                        onChange={(e) => updateSettings({ skipHolidays: e.target.checked })}
                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-slate-700 dark:text-slate-300">跳过法定节假日</span>
                                </label>
                            </div>

                             {settings.workMode === 'big-small' && (
                                <div className="md:col-span-2 flex items-center justify-between bg-white dark:bg-slate-800 p-2 rounded border border-gray-200 dark:border-slate-700">
                                    <span className="text-sm text-slate-700 dark:text-slate-300">当前周状态</span>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => updateSettings({ isBigWeek: true })}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${settings.isBigWeek ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-700'}`}
                                        >
                                            大周 (周六班)
                                        </button>
                                        <button 
                                            onClick={() => updateSettings({ isBigWeek: false })}
                                            className={`px-3 py-1 text-xs rounded transition-colors ${!settings.isBigWeek ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-700'}`}
                                        >
                                            小周 (周六休)
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className={`space-y-3 transition-all duration-300 ${settings.activeHoursEnabled ? 'opacity-100' : 'opacity-50 grayscale pointer-events-none'}`}>
                    {settings.activeHoursRanges.map((range, index) => (
                        <div key={range.id} className="flex items-end gap-2 bg-gray-50 dark:bg-slate-900 p-2 rounded border border-gray-200 dark:border-slate-700">
                            <div className="flex-1">
                                <label className="text-xs text-slate-500 mb-1 block">开始 {index + 1}</label>
                                <input
                                    type="time"
                                    value={range.start}
                                    onChange={(e) => updateTimeRange(range.id, 'start', e.target.value)}
                                    style={{ colorScheme: settings.theme === 'dark' ? 'dark' : 'light', accentColor: '#2563eb' }}
                                    className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            <div className="flex items-center justify-center pb-2 text-slate-500">→</div>
                            <div className="flex-1">
                                <label className="text-xs text-slate-500 mb-1 block">结束 {index + 1}</label>
                                <input
                                    type="time"
                                    value={range.end}
                                    onChange={(e) => updateTimeRange(range.id, 'end', e.target.value)}
                                    style={{ colorScheme: settings.theme === 'dark' ? 'dark' : 'light', accentColor: '#2563eb' }}
                                    className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded px-2 py-1 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            <button 
                                onClick={() => removeTimeRange(range.id)}
                                className="bg-red-50 text-red-500 dark:bg-red-500/20 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/30 p-1.5 rounded mb-0.5 transition-colors"
                                title="删除此时间段"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    ))}
                    
                    <button 
                        onClick={addTimeRange}
                        className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg text-sm transition-all"
                    >
                        + 添加时间段
                    </button>
                    {settings.activeHoursRanges.length === 0 && (
                        <p className="text-xs text-center text-slate-400 mt-2">
                            未设置时间段时，将在工作模式允许的所有时间内运行。
                        </p>
                    )}
                </div>
            </div>

            <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-slate-700 pb-2">声音设置</label>
                <div className="flex items-center justify-between bg-gray-50 dark:bg-slate-900/50 p-3 rounded-lg border border-gray-200 dark:border-slate-700/50">
                    <span className="text-slate-700 dark:text-slate-300 font-medium">开启声音提醒</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                            type="checkbox" 
                            name="soundEnabled" 
                            checked={settings.soundEnabled} 
                            onChange={handleChange} 
                            className="sr-only peer" 
                        />
                        <div className="w-11 h-6 bg-gray-300 dark:bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                </div>
                {settings.soundEnabled && (
                    <div className="space-y-4 pt-2">
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs text-slate-500">音量调节</label>
                                <span className="text-xs text-slate-400 font-mono">{Math.round(settings.audioVolume * 100)}%</span>
                            </div>
                            <input 
                                type="range" 
                                name="audioVolume" 
                                min="0" 
                                max="1" 
                                step="0.05" 
                                value={settings.audioVolume} 
                                onChange={handleChange}
                                className="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs text-slate-500 block">选择提示音</label>
                            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
                                {settings.soundList.map((sound) => (
                                    <div 
                                        key={sound.id} 
                                        className={`flex items-center p-3 border-b border-gray-100 dark:border-slate-800 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors ${settings.selectedSoundId === sound.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                                    >
                                        <input 
                                            type="radio" 
                                            name="soundSelection"
                                            checked={settings.selectedSoundId === sound.id}
                                            onChange={() => selectAudio(sound.id)}
                                            className="w-4 h-4 text-blue-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:ring-0 focus:outline-none focus:ring-offset-0 cursor-pointer"
                                        />
                                        <span className="ml-3 text-sm text-slate-800 dark:text-slate-200 flex-1 truncate cursor-pointer" onClick={() => selectAudio(sound.id)}>
                                            {sound.name}
                                            {sound.type === 'system' && <span className="ml-2 text-[10px] bg-gray-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded">系统</span>}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => previewingId === sound.id ? stopPreviewAudio() : previewAudio(sound.id)}
                                                className={`p-1.5 rounded-full transition-colors ${previewingId === sound.id ? 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300'}`}
                                                title="试听"
                                            >
                                                {previewingId === sound.id ? (
                                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                                                ) : (
                                                    <svg className="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                )}
                                            </button>
                                            {sound.type === 'custom' && (
                                                <button
                                                    onClick={() => deleteCustomAudio(sound.id)}
                                                    className="p-1.5 rounded-full bg-gray-200 dark:bg-slate-700 hover:bg-red-100 dark:hover:bg-red-900/50 text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                                    title="删除"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                             <div className="mt-2">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={onFileChange}
                                    accept="audio/*"
                                    className="hidden"
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg text-sm transition-all flex items-center justify-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                    上传自定义提示音
                                </button>
                                <p className="text-[10px] text-slate-400 mt-1 text-center">支持 MP3, WAV, OGG 等格式，建议时长不超过 30 秒</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </div>
    </>
  );
};

export default SettingsPanel;
