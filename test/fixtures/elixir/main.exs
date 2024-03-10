defmodule Main do
  def run do
    [file_path | _] = System.argv()

    file_path
    |> File.read!()
    |> Jason.decode!(%{objects: :ordered_objects})
    |> Jason.encode!()
    |> IO.puts()
  end
end

Main.run()
