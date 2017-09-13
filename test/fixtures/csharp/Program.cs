using System;

namespace QuickType
{
    class Program
    {
        static void Main(string[] args)
        {
            var path = args[0];
            var json = System.IO.File.ReadAllText(path);
            var output = TopLevel.FromJson(json).ToJson();
            Console.WriteLine("{0}", output);
        }
    }
}
