import test from 'node:test';import assert from 'node:assert/strict';
import {hasMoreToRead,nextReadingScroll,remainingScroll,canSubmitInput} from '../hex/play-reading.ts';
test('长段落按可视高度推进并留上下文，不越过末尾',()=>{
 let p={scrollTop:0,clientHeight:100,scrollHeight:325};
 assert.equal(hasMoreToRead(p),true);assert.equal(nextReadingScroll(p),80);
 p.scrollTop=160;assert.equal(nextReadingScroll(p),225);
 p.scrollTop=225;assert.equal(hasMoreToRead(p),false);assert.equal(nextReadingScroll(p),225);
});
test('短段落、隐藏区域和亚像素底部不产生多余阅读页',()=>{
 assert.equal(hasMoreToRead({scrollTop:0,clientHeight:0,scrollHeight:500}),false);
 assert.equal(hasMoreToRead({scrollTop:0,clientHeight:100,scrollHeight:80}),false);
 assert.equal(hasMoreToRead({scrollTop:221.5,clientHeight:100,scrollHeight:325}),false);
 assert.equal(remainingScroll({scrollTop:240,clientHeight:100,scrollHeight:325}),0);
});
test('Safari顶部回弹仍按实际起点向下翻页',()=>{
 const p={scrollTop:-20,clientHeight:100,scrollHeight:325};
 assert.equal(remainingScroll(p),225);assert.equal(nextReadingScroll(p),80);
});
test('中文组合状态及兼容229键码不提交；结束后新Enter可提交',()=>{
 const e={key:'Enter',isComposing:false,keyCode:13,repeat:false};
 assert.equal(canSubmitInput(e,true),false);
 assert.equal(canSubmitInput({...e,isComposing:true},false),false);
 assert.equal(canSubmitInput({...e,keyCode:229},false),false);
 assert.equal(canSubmitInput(e,false),true);
});
test('长按Enter和其他按键不自动生成下一次预览',()=>{
 const e={key:'Enter',isComposing:false,keyCode:13,repeat:false};
 assert.equal(canSubmitInput({...e,repeat:true},false),false);
 assert.equal(canSubmitInput({...e,key:'Escape'},false),false);
});
