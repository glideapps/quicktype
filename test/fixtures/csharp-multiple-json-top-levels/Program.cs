using System;
using System.IO;

namespace QuickType
{
    class Program
    {
        static void Main(string[] args)
        {
            var path = args[0];
            var json = File.ReadAllText(path);
            string output;

            switch (Path.GetFileName(path))
            {
                case "AccountsGet.Request.json":
                {
                    AccountsGetRequest value = AccountsGetRequest.FromJson(json);
                    output = value.ToJson();
                    break;
                }
                case "AuthGet.Request.json":
                {
                    AuthGetRequest value = AuthGetRequest.FromJson(json);
                    AuthGetRequestOptions options = value.Options;
                    output = value.ToJson();
                    break;
                }
                case "TransactionsGet.Request.json":
                {
                    TransactionsGetRequest value = TransactionsGetRequest.FromJson(json);
                    TransactionsGetRequestOptions options = value.Options;
                    output = value.ToJson();
                    break;
                }
                default:
                    throw new ArgumentException($"Unexpected fixture input: {path}");
            }

            Console.WriteLine(output);
        }
    }
}
