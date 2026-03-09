const modules = {
  raven : 1 << 1,
  chatbot: 1 <<2,
  datalab: 1<<3
}

let raven_chatbot = modules.raven | modules.chatbot;
let has_raven_chatbot = (raven_chatbot & modules.raven) === modules.raven;

let DatalabSupport = (raven_chatbot & modules.datalab ) === modules.datalab

console.log('Available Features: 📝',modules);
console.log(raven_chatbot,"code has raven(2)✅", has_raven_chatbot);
console.log(raven_chatbot,"code has Daven(8)✅", (raven_chatbot & modules.datalab) === modules.datalab);
console.log('🟥 Has Datalab access',DatalabSupport)
