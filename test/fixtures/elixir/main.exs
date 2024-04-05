defmodule Main do
  def run do
    [file_path | _] = System.argv()

    file_path
    |> File.read!()
    |> TopLevel.from_json()
    |> TopLevel.to_json()
    |> IO.puts()
  end
end

Main.run()
