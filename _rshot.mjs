import puppeteer from 'puppeteer-core'
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const B='http://localhost:3001'
const browser=await puppeteer.launch({executablePath:CHROME,headless:'new'})
const page=await browser.newPage()
await page.setViewport({width:1600,height:1200,deviceScaleFactor:2})
await page.goto(`${B}/login`,{waitUntil:'networkidle0'})
await page.waitForSelector('button[type=submit]'); await new Promise(r=>setTimeout(r,1200))
await page.type('input[type=email]','admin@agency.local',{delay:10})
await page.type('input[type=password]','password123',{delay:10})
await Promise.all([page.waitForNavigation({waitUntil:'networkidle0',timeout:30000}).catch(()=>{}),page.click('button[type=submit]')])
await new Promise(r=>setTimeout(r,2000))
await page.goto(`${B}/dashboard`,{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,2500))
// report computed font sizes of the stat values
const info = await page.evaluate(()=>{
  const out=[]
  document.querySelectorAll('div,span,p').forEach(el=>{
    const t=el.textContent?.trim()
    if(t && /^(Total clicks|Fans|Revenue)$/.test(t)){
      const sib=el.nextElementSibling
      out.push({label:t, labelSize:getComputedStyle(el).fontSize, valueText:sib?.textContent?.trim().slice(0,20), valueSize:sib?getComputedStyle(sib).fontSize:null, valueClass:sib?.className?.slice(0,80)})
    }
  })
  return out
})
console.log(JSON.stringify(info,null,1))
await page.screenshot({path:'/tmp/shots/reddit-dash.png', clip:{x:0,y:0,width:1600,height:560}})
console.log('shot')
await browser.close()
