const express = require("express")
const axios = require("axios")
const cors = require("cors")
const multer = require("multer")
const XLSX = require("xlsx")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcrypt")
require("dotenv").config()

const db = require("./db")

const app = express()
app.use(cors())
app.use(express.json())

const upload = multer({ storage: multer.memoryStorage() })

let masterData = []

async function loadMaster(){
const url = "https://opensheet.elk.sh/1u4McrZ2B2QAalNvdGJZJsjumahiMviWU1sfC5Z1RWa8/Sheet1"
const res = await axios.get(url)
masterData = res.data
console.log("Master loaded:", masterData.length)
}

setInterval(loadMaster, 300000)

function auth(req,res,next){
const token = req.headers.authorization
if(!token) return res.status(401).send("No token")

try{
req.user = jwt.verify(token, process.env.JWT_SECRET)
next()
}catch{
res.status(403).send("Invalid token")
}
}

app.post("/register", async (req,res)=>{
const {username,password} = req.body
const hash = await bcrypt.hash(password,10)
await db.query("INSERT INTO users(username,password) VALUES($1,$2)",[username,hash])
res.json({status:"ok"})
})

app.post("/login", async (req,res)=>{
const {username,password} = req.body
const user = await db.query("SELECT * FROM users WHERE username=$1",[username])
if(user.rows.length==0) return res.status(401).send("User not found")
const valid = await bcrypt.compare(password,user.rows[0].password)
if(!valid) return res.status(401).send("Wrong password")
const token = jwt.sign({id:user.rows[0].id},process.env.JWT_SECRET)
res.json({token})
})

app.post("/upload-stock", auth, upload.single("file"), async (req,res)=>{
const wb = XLSX.read(req.file.buffer)
const sheet = wb.Sheets[wb.SheetNames[0]]
let data = XLSX.utils.sheet_to_json(sheet)

await db.query("DELETE FROM stock")

for(let r of data){
await db.query(
"INSERT INTO stock(material,plant,stock,sloc,bin) VALUES($1,$2,$3,$4,$5)",
[
r.Material || r["Material Number"],
r.Plant || "",
r.Stock || r["Unrestricted"] || 0,
r.SLoc || "",
r.Bin || ""
]
)
}

res.json({status:"uploaded"})
})

app.get("/data", auth, async (req,res)=>{
let stock = await db.query("SELECT * FROM stock")

let grouped = {}

stock.rows.forEach(s=>{
if(!grouped[s.material]){
grouped[s.material] = {
material: s.material,
plant: s.plant,
stock: 0,
locations: []
}
}
grouped[s.material].stock += s.stock
grouped[s.material].locations.push({
sloc: s.sloc,
bin: s.bin,
stock: s.stock
})
})

let result = Object.values(grouped).map(r=>{
let m = masterData.find(x => x.Material == r.material)
return {
...r,
desc: m?.Description || "",
po: m?.["PO Text"] || ""
}
})

res.json(result)
})

app.listen(process.env.PORT || 3000, async ()=>{
await loadMaster()
console.log("Server running")
})
