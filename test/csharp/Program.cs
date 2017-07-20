using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;

namespace test
{
    class Program
    {
        static void Main(string[] args) => TestParse(args[0]).Wait();

        static async Task TestParse(string url)
        {
            var client = new HttpClient();
            client.DefaultRequestHeaders.Accept.Clear();
            client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            var json = await client.GetStringAsync(url);
            var qt = QuickType.TopLevel.FromJson(json);
        }
    }
}
