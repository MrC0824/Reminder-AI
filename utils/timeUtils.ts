import { TimeRange, WorkMode } from "@/types";

export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds > 359999) {
    return ">99h";
  }

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const formatDateTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

const holidaysCache: Set<string> = new Set();
let lastFetchYear: number = 0;

export const updateHolidays = async () => {
   const year = new Date().getFullYear();
   if (year === lastFetchYear && holidaysCache.size > 0) return;
   
   try {
       const res = await fetch(`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`);
       if (!res.ok) throw new Error('Network response was not ok');
       const data = await res.json();
       
       if (data && data.days && Array.isArray(data.days)) {
           holidaysCache.clear();
           data.days.forEach((d: any) => {
               if (d.isOffDay) holidaysCache.add(d.date);
           });
           lastFetchYear = year;
           console.log(`[TimeUtils] Updated holidays for ${year}, total off days: ${holidaysCache.size}`);
       }
   } catch (e) { 
       console.error("[TimeUtils] Failed to fetch holidays:", e); 
   }
}

export const isWorkDay = (mode: WorkMode, skipHolidays: boolean, isBigWeek: boolean): boolean => {
    const now = new Date();
    
    if (skipHolidays) {
        const dateStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;
        if (holidaysCache.has(dateStr)) {
            return false;
        }
    }

    const day = now.getDay();
    if (mode === 'everyday') return true;
    if (mode === 'weekend') return day === 0 || day === 6;
    if (mode === 'big-small') {
        if (day === 0) return false;
        if (day === 6) return isBigWeek;
        return true;
    }
    return true;
}

export const isWithinActiveHours = (ranges: TimeRange[]): boolean => {
  if (!ranges || ranges.length === 0) return true;

  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  return ranges.some(range => {
    if (!range.start || !range.end) return false;

    const [startH, startM] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);

    const startTime = startH * 60 + startM;
    const endTime = endH * 60 + endM;

    if (endTime > startTime) {
      return currentTime >= startTime && currentTime < endTime;
    } else {
      return currentTime >= startTime || currentTime < endTime;
    }
  });
};

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 9);
};