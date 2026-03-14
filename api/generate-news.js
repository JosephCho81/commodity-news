import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

export default async function handler(req, res) {

const today = new Date().toISOString().slice(0,10)

// Firebase 설정 (환경변수 사용)
const firebaseConfig = {
 apiKey: process.env.FIREBASE_API_KEY,
 authDomain: process.env.FIREBASE_AUTH_DOMAIN,
 projectId: process.env.FIREBASE_PROJECT_ID
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)


// 오늘 뉴스 존재 확인
const todayDoc = await getDoc(doc(db,"daily_news",today))

if(todayDoc.exists()){
 return res.json({
  status:"already-exists",
  data: todayDoc.data()
 })
}


// LME 가격
async function getLME(){

 const r = await fetch(
 "https://query1.finance.yahoo.com/v7/finance/quote?symbols=ALI=F"
 )

 const j = await r.json()

 return j.quoteResponse.result[0]?.regularMarketPrice || null

}



// RSS 뉴스 수집
async function fetchRSS(url){

 const r = await fetch(url)

 const xml = await r.text()

 const items = xml.split("<item>").slice(1,50)

 return items.map(item => {

  const title = item.match(/<title>(.*?)<\/title>/)?.[1] || ""
  const link = item.match(/<link>(.*?)<\/link>/)?.[1] || ""

  return {title,url:link}

 })

}



// 뉴스 수집
async function collectNews(){

 const feeds = [

 "https://news.google.com/rss/search?q=aluminum+market",
 "https://news.google.com/rss/search?q=steel+scrap",
 "https://news.google.com/rss/search?q=iron+ore",
 "https://news.google.com/rss/search?q=steel+industry"

 ]

 let news = []

 for(const f of feeds){

  const r = await fetchRSS(f)

  news = news.concat(r)

 }

 return news

}



// 중복 제거
function removeDuplicates(news){

 const seen = new Set()

 return news.filter(n=>{

  if(seen.has(n.title)) return false

  seen.add(n.title)

  return true

 })

}



// URL 확인
async function verifyURL(url){

 try{

  const r = await fetch(url,{method:"HEAD"})

  return r.status === 200

 }catch{

  return false

 }

}



// URL 필터
async function filterValid(news){

 const valid = []

 for(const n of news.slice(0,50)){

  const ok = await verifyURL(n.url)

  if(ok) valid.push(n)

 }

 return valid

}



// 뉴스 중요도 필터
function scoreNews(news){

 return news.map(n=>{

  let score = 1

  if(n.url.includes("reuters")) score=5
  if(n.url.includes("bloomberg")) score=5
  if(n.url.includes("ft.com")) score=4
  if(n.url.includes("mining.com")) score=3

  return {...n,score}

 }).sort((a,b)=>b.score-a.score)

}



// AI 분석
async function analyze(news){

 const r = await fetch(

 `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,

 {

 method:"POST",

 headers:{
 "Content-Type":"application/json"
 },

 body:JSON.stringify({

 contents:[{

 parts:[{

 text:`

다음 글로벌 원자재 뉴스를 분석하여
한국 제강사 원료구매팀 임원 보고용 시장 리포트를 작성하라.

조건

1 글로벌 시장 요약 5줄
2 알루미늄 시장 영향
3 철스크랩 시장 영향
4 철광석 시장 영향
5 향후 가격 방향

뉴스 데이터

${JSON.stringify(news)}

`

 }]

 }]

 })

 }

 )

 const j = await r.json()

 return j?.candidates?.[0]?.content?.parts?.[0]?.text || ""

}



// 실행
const lmePrice = await getLME()

let news = await collectNews()

news = removeDuplicates(news)

news = await filterValid(news)

news = scoreNews(news)

const briefing = await analyze(news.slice(0,20))



// Firestore 저장
await setDoc(doc(db,"daily_news",today),{

date: today,

lme_aluminum: lmePrice,

daily_briefing: briefing,

news: news.slice(0,20)

})



res.json({

status:"saved",

date:today,

lme:lmePrice,

articles:news.length

})

}
