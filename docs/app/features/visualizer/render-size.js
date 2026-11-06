/** Limit preview GPU allocations while retaining exact export dimensions. */
export function renderSize(width,height,deviceRatio=1,resolution=null){
 const w=Math.round(resolution?.width||width),h=Math.round(resolution?.height||height);
 if(!Number.isFinite(w)||!Number.isFinite(h)||w<2||h<2)return null;
 return{width:w,height:h,pixelRatio:resolution?1:Math.min(1.5,Math.max(.1,deviceRatio||1),Math.sqrt(1_800_000/(w*h)))};
}
