using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;
class Launcher {
    [STAThread] static void Main() {
        string root=AppDomain.CurrentDomain.BaseDirectory, url="http://127.0.0.1:4310";
        try {
            bool ready=Ready(url+"/api/bootstrap");
            if(!ready) {
                var p=new ProcessStartInfo(Path.Combine(root,"runtime","node.exe"),"\""+Path.Combine(root,"server-bundle.cjs")+"\"");
                p.WorkingDirectory=root; p.UseShellExecute=false; p.CreateNoWindow=true;
                p.EnvironmentVariables["FAIRWAY_APP_ROOT"]=root; Process.Start(p);
                for(int i=0;i<50 && !ready;i++) { Thread.Sleep(200); ready=Ready(url+"/api/bootstrap"); }
            }
            if(!ready) throw new Exception("The booth could not start. Check that port 4310 is free, and extract the whole folder before opening it.");
            string edge=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Microsoft","Edge","Application","msedge.exe");
            if(File.Exists(edge)) Process.Start(new ProcessStartInfo(edge,"--app="+url+" --window-size=1440,960") { UseShellExecute=true });
            else Process.Start(new ProcessStartInfo(url) { UseShellExecute=true });
        } catch(Exception e) { MessageBox.Show(e.Message,"Fairway Studio",MessageBoxButtons.OK,MessageBoxIcon.Error); }
    }
    static bool Ready(string url) { try { var req=(HttpWebRequest)WebRequest.Create(url); req.Timeout=350; using(var res=req.GetResponse()) using(var reader=new StreamReader(res.GetResponseStream())) return reader.ReadToEnd().Contains("\"temporary\":true"); } catch { return false; } }
}
