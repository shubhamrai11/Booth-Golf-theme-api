using System;
using System.Drawing;
using System.Drawing.Printing;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class PrintPhoto {
    static int Main(string[] args) {
        try {
            if(args.Length==1 && args[0]=="--list") {
                var names=new List<string>(); foreach(string name in PrinterSettings.InstalledPrinters) names.Add(name);
                Console.WriteLine(new JavaScriptSerializer().Serialize(names)); return 0;
            }
            if(args.Length!=2) throw new Exception("Choose an image and printer.");
            using(var image=Image.FromFile(args[0])) using(var doc=new PrintDocument()) {
                doc.PrinterSettings.PrinterName=args[1];
                if(!doc.PrinterSettings.IsValid) throw new Exception("The selected Windows printer is unavailable.");
                doc.PrinterSettings.Copies=1; doc.DocumentName="Fairway Studio portrait";
                doc.PrintController=new StandardPrintController(); doc.DefaultPageSettings.Landscape=false;
                foreach(PaperSize paper in doc.PrinterSettings.PaperSizes) if(Math.Abs(paper.Width-400)<12 && Math.Abs(paper.Height-600)<12) { doc.DefaultPageSettings.PaperSize=paper; break; }
                doc.DefaultPageSettings.Margins=new Margins(0,0,0,0);
                doc.PrintPage+=(sender,e)=>{
                    var area=e.PageSettings.PrintableArea;
                    float ratio=Math.Min(area.Width/image.Width,area.Height/image.Height);
                    float w=image.Width*ratio,h=image.Height*ratio;
                    float x=area.X+(area.Width-w)/2-e.PageSettings.HardMarginX;
                    float y=area.Y+(area.Height-h)/2-e.PageSettings.HardMarginY;
                    e.Graphics.DrawImage(image,x,y,w,h); e.HasMorePages=false;
                };
                doc.Print(); Console.WriteLine("Sent to printer"); return 0;
            }
        } catch(Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
    }
}
