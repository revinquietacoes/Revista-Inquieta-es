
window.AppPanel = {
  async apiData(action){
    const userId = localStorage.getItem("user_id") || "";
    const res = await fetch("/.netlify/functions/data?action="+action,{
      headers:{
        "x-user-id": userId
      }
    });
    return await res.json();
  },
  async apiAction(action,body={}){
    const userId = localStorage.getItem("user_id") || "";
    const res = await fetch("/.netlify/functions/action?action="+action,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-user-id": userId
      },
      body: JSON.stringify(body)
    });
    return await res.json();
  }
};
