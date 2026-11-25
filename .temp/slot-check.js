function pad(n){return (n<10?'0':'')+n;}
var tests=[[10,0],[7,45],[13,30],[8,30],[7,30],[13,45],[14,0],[12,30]];
tests.forEach(function(t){
  var h=t[0],m=t[1];
  var inWindow=(h===7&&m>=30)||(h===13&&m>=30);
  var note = inWindow ? (h<12?'上午档推送':'下午档推送') : 'idle 跳过';
  console.log(pad(h)+':'+pad(m)+' → '+note);
});
