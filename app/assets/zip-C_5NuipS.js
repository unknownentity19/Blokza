const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/zip-DGXD5IHN.js","assets/vendor-DnQQq7lD.js"])))=>i.map(i=>d[i]);
import{_ as p,s as f,d}from"./index-C6_uXc0J.js";import{buildExport as h}from"./export-DxxuWh49.js";import"./vendor-DnQQq7lD.js";async function w(e){const{default:o}=await p(async()=>{const{default:t}=await import("./zip-DGXD5IHN.js").then(r=>r.j);return{default:t}},__vite__mapDeps([0,1])),{files:i,bytes:n}=h(e),s=new o;for(const t of i)s.file(t.path,t.content);s.file("README.txt",m(e,i.map(t=>t.path)));const l=await s.generateAsync({type:"blob",compression:"DEFLATE"}),a=`${f(e.name,"site")}.zip`;return d(a,l),{filename:a,files:i.length,bytes:n}}function m(e,o){const i=o.filter(n=>n.endsWith(".html"));return`${e.name}
${"=".repeat(e.name.length)}

Exported from the Altask builder.

Contents
--------
${o.map(n=>`  ${n}`).join(`
`)}

Viewing it locally
------------------
Open index.html in a browser. Every link between pages is a relative filename,
so it works straight from this folder with no server.

Hosting it
----------
Upload the whole folder as-is. It is plain HTML and CSS with no build step, so
it works on Netlify, Vercel, GitHub Pages, Cloudflare Pages, S3, or any static
host. Point the host's publish directory at this folder.

Pages: ${i.length}
Stylesheet: styles.css (one file, all pages)
Generated: ${new Date(e.updatedAt).toISOString()}
`}export{w as downloadSiteZip};
