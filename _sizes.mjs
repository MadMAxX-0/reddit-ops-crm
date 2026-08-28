import puppeteer from 'puppeteer-core'
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const B='http://localhost:3001'
const browser=await puppeteer.launch({executablePath:CHROME,headless:'new'})
const page=await browser.newPage()
await page.setViewport({width:1500,height:1400,deviceScaleFactor:2})
await page.goto(`${B}/login`,{waitUntil:'networkidle0'})
await page.waitForSelector('button[type=submit]'); await new Promise(r=>setTimeout(r,1000))
await page.type('input[type=email]','admin@agency.local',{delay:8})
await page.type('input[type=password]','password123',{delay:8})
await Promise.all([page.waitForNavigation({waitUntil:'networkidle0',timeout:30000}).catch(()=>{}),page.click('button[type=submit]')])
await page.goto(`${B}/dashboard`,{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,2200))

const box = await page.evaluate(()=>{
  const val=[...document.querySelectorAll('div')].find(d=>d.className.includes('text-36')&&d.className.includes('mono'))
  const card=val.parentElement
  const grid=card.parentElement
  const wrap=document.createElement('div')
  wrap.id='sizecmp'
  wrap.style.cssText='position:fixed;inset:0;z-index:99999;background:#0a0a0a;padding:28px;overflow:auto;font-family:inherit'
  for(const px of [22,26,30,36,42,48]){
    const row=document.createElement('div')
    row.style.cssText='display:flex;align-items:center;gap:20px;margin-bottom:14px'
    const tag=document.createElement('div')
    tag.textContent=px+'px'
    tag.style.cssText='width:56px;color:#f97316;font:600 15px ui-monospace,monospace'
    const c=card.cloneNode(true)
    c.style.width='620px'
    const v=[...c.querySelectorAll('div')].find(d=>d.className.includes('mono'))
    v.className=v.className.replace(/text-\d+/,'')
    v.style.fontSize=px+'px'
    v.style.lineHeight=(px+4)+'px'
    row.appendChild(tag); row.appendChild(c)
    wrap.appendChild(row)
  }
  document.body.appendChild(wrap)
  const r=wrap.getBoundingClientRect()
  return {w:Math.ceil(r.width),h:Math.ceil(Math.min(r.height, wrap.scrollHeight))}
})
await new Promise(r=>setTimeout(r,400))
await page.screenshot({path:'/tmp/shots/sizes.png', clip:{x:0,y:0,width:800,height:Math.min(box.h,1300)}})
console.log('ok')
await browser.close()
