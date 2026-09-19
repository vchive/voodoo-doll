import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// HTTP频率和实际模型请求额度分开；单进程部署下每日额度跨重启保留。
export class RateLimiter {
  constructor({perMinute=20,dailyLimit=300,usageFile,now=()=>Date.now()}={}) {
    Object.assign(this,{perMinute,dailyLimit,usageFile,now});
    this.buckets=new Map();
    this.day=''; this.usedToday=0;
    if (usageFile) {
      try {
        const saved=JSON.parse(readFileSync(usageFile,'utf8'));
        this.day=typeof saved.day==='string'?saved.day:'';
        this.usedToday=Number.isSafeInteger(saved.usedToday)&&saved.usedToday>=0?saved.usedToday:dailyLimit;
      } catch (error) {
        if (error.code!=='ENOENT') {this.day=this.today(); this.usedToday=dailyLimit;}
      }
    }
    this.rollover();
  }
  today(){return new Date(this.now()).toISOString().slice(0,10);}
  rollover(){if(this.day!==this.today()){this.day=this.today();this.usedToday=0;this.buckets.clear();}}
  check(ip) {
    const now=this.now();
    const hits=(this.buckets.get(ip)||[]).filter(t=>now-t<60000);
    if(hits.length>=this.perMinute)return {allowed:false,reason:'rate-limited'};
    hits.push(now);this.buckets.set(ip,hits);
    if(this.buckets.size>5000)for(const[key,times]of this.buckets)if(!times.some(t=>now-t<60000))this.buckets.delete(key);
    return {allowed:true};
  }
  consumeModelRequest() {
    this.rollover();
    if(this.usedToday>=this.dailyLimit)return {allowed:false,reason:'daily-budget-exhausted'};
    this.usedToday++;
    if(this.usageFile){
      try {
        mkdirSync(path.dirname(this.usageFile),{recursive:true});
        const temp=this.usageFile+'.'+process.pid+'.tmp';
        writeFileSync(temp,JSON.stringify({day:this.day,usedToday:this.usedToday}),{mode:0o600});
        renameSync(temp,this.usageFile);
      } catch { this.usedToday=this.dailyLimit;return {allowed:false,reason:'budget-storage-unavailable'}; }
    }
    return {allowed:true};
  }
  stats(){this.rollover();return {usedToday:this.usedToday,dailyLimit:this.dailyLimit,day:this.day};}
}
