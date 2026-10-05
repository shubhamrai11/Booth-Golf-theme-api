using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
class CanonCapture {
    static IntPtr camera=IntPtr.Zero, list=IntPtr.Zero;
    static string output, captureError;
    static bool done=false;
    static ObjectHandler handler=OnObject;
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint ObjectHandler(uint evt, IntPtr obj, IntPtr context);
    [StructLayout(LayoutKind.Sequential)] struct Capacity { public int clusters, bytes, reset; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] struct ItemInfo {
        public ulong size; public int isFolder; public uint groupID, option;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string filename;
        public uint format, dateTime;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetDllDirectory(string path);
    [DllImport("EDSDK.dll")] static extern uint EdsInitializeSDK();
    [DllImport("EDSDK.dll")] static extern uint EdsTerminateSDK();
    [DllImport("EDSDK.dll")] static extern uint EdsGetCameraList(out IntPtr list);
    [DllImport("EDSDK.dll")] static extern uint EdsGetChildCount(IntPtr list,out int count);
    [DllImport("EDSDK.dll")] static extern uint EdsGetChildAtIndex(IntPtr list,int index,out IntPtr child);
    [DllImport("EDSDK.dll")] static extern uint EdsOpenSession(IntPtr camera);
    [DllImport("EDSDK.dll")] static extern uint EdsCloseSession(IntPtr camera);
    [DllImport("EDSDK.dll")] static extern uint EdsSetPropertyData(IntPtr obj,uint id,int param,int size,ref uint value);
    [DllImport("EDSDK.dll")] static extern uint EdsSetCapacity(IntPtr camera,Capacity capacity);
    [DllImport("EDSDK.dll")] static extern uint EdsSetObjectEventHandler(IntPtr camera,uint evt,ObjectHandler handler,IntPtr context);
    [DllImport("EDSDK.dll")] static extern uint EdsSendCommand(IntPtr camera,uint command,int param);
    [DllImport("EDSDK.dll")] static extern uint EdsGetEvent();
    [DllImport("EDSDK.dll")] static extern uint EdsGetDirectoryItemInfo(IntPtr item,out ItemInfo info);
    [DllImport("EDSDK.dll",CharSet=CharSet.Ansi)] static extern uint EdsCreateFileStream(string name,uint disposition,uint access,out IntPtr stream);
    [DllImport("EDSDK.dll")] static extern uint EdsDownload(IntPtr item,ulong size,IntPtr stream);
    [DllImport("EDSDK.dll")] static extern uint EdsDownloadComplete(IntPtr item);
    [DllImport("EDSDK.dll")] static extern uint EdsDownloadCancel(IntPtr item);
    [DllImport("EDSDK.dll")] static extern uint EdsRelease(IntPtr obj);
    static void Check(uint e,string action) { if(e!=0) throw new Exception(action+" failed (Canon 0x"+e.ToString("X8")+"). Check focus, JPEG mode and USB; close EOS Utility."); }
    static uint OnObject(uint evt,IntPtr obj,IntPtr context) {
        IntPtr stream=IntPtr.Zero;
        try {
            if(evt==0x00000208 && !done) {
                ItemInfo info; Check(EdsGetDirectoryItemInfo(obj,out info),"Read camera image");
                if(!info.filename.EndsWith(".JPG",StringComparison.OrdinalIgnoreCase) && !info.filename.EndsWith(".JPEG",StringComparison.OrdinalIgnoreCase)) { EdsDownloadCancel(obj); return 0; }
                Check(EdsCreateFileStream(output,1,2,out stream),"Create photo");
                Check(EdsDownload(obj,info.size,stream),"Download JPEG");
                Check(EdsDownloadComplete(obj),"Complete transfer"); done=true;
            } else if(evt==0x00000208) EdsDownloadCancel(obj);
        } catch(Exception ex) { captureError=ex.Message; done=true; if(obj!=IntPtr.Zero) EdsDownloadCancel(obj); }
        finally { if(stream!=IntPtr.Zero) EdsRelease(stream); if(obj!=IntPtr.Zero) EdsRelease(obj); }
        return 0;
    }
    [STAThread] static int Main(string[] args) {
        bool initialized=false, opened=false;
        try {
            if(args.Length!=2) throw new Exception("Expected SDK folder and JPEG output path.");
            SetDllDirectory(Path.GetFullPath(args[0])); output=Path.GetFullPath(args[1]);
            Check(EdsInitializeSDK(),"Initialize SDK"); initialized=true;
            Check(EdsGetCameraList(out list),"Find camera"); int count; Check(EdsGetChildCount(list,out count),"Count cameras");
            if(count==0) throw new Exception("No Canon camera found. Connect USB, turn the camera on and close EOS Utility.");
            Check(EdsGetChildAtIndex(list,0,out camera),"Select camera"); Check(EdsOpenSession(camera),"Open camera"); opened=true;
            Check(EdsSetObjectEventHandler(camera,0x00000200,handler,IntPtr.Zero),"Register transfer");
            uint save=2; Check(EdsSetPropertyData(camera,0x0000000b,0,4,ref save),"Set host save");
            Check(EdsSetCapacity(camera,new Capacity { clusters=0x7fffffff,bytes=4096,reset=1 }),"Set capacity");
            Check(EdsSendCommand(camera,0,0),"Release shutter");
            DateTime end=DateTime.UtcNow.AddSeconds(50);
            while(!done && DateTime.UtcNow<end) { EdsGetEvent(); System.Windows.Forms.Application.DoEvents(); Thread.Sleep(50); }
            if(!done) throw new Exception("Camera transfer timed out. Set JPEG capture and check autofocus and USB.");
            if(captureError!=null) throw new Exception(captureError);
            Console.WriteLine("Captured"); return 0;
        } catch(DllNotFoundException) { Console.Error.WriteLine("Canon EDSDK or its dependencies could not load. Install the complete Canon 64-bit SDK runtime."); return 1; }
        catch(BadImageFormatException) { Console.Error.WriteLine("This capture bridge needs the 64-bit Canon EDSDK runtime."); return 1; }
        catch(Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
        finally { if(opened) EdsCloseSession(camera); if(camera!=IntPtr.Zero) EdsRelease(camera); if(list!=IntPtr.Zero) EdsRelease(list); if(initialized) EdsTerminateSDK(); }
    }
}
