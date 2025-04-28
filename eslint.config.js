
const pd = {
  name : "fazlul",
  age : 69
}
const partnerInfo = {
  appUrl : false
}

const payload = {
  ...pd,
  ...(partnerInfo?.appUrl && {partner : partnerInfo.appUrl}),
  ...(undefined)
}

console.log(payload)