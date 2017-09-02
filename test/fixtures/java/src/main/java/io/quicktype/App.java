package io.quicktype;

import java.nio.file.*;

/**
 * Hello world!
 *
 */
public class App 
{
    public static void main( String[] args )
    {
        try {
            String input = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(args[0])), "UTF-8");
            String output = Converter.toJsonString(Converter.fromJsonString(input));
            byte[] arr = output.getBytes("UTF-8");
            System.out.write(arr, 0, arr.length);
        } catch (Exception exc) {
            System.err.printf("Error: %s\n", exc.getMessage());
            System.exit(1);
        }
    }
}
