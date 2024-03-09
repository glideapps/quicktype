defmodule Main do
  def run do
    [file | _] = System.argv()

    file
    |> File.read!()
    |> Jason.decode!()
    # TODO: Test generated code
    |> Jason.encode!()
    |> IO.puts()
  end
end

Main.run()

# mix run main.exs ../../inputs/schema/any.1.json
