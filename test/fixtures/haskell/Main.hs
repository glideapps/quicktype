{-# LANGUAGE OverloadedStrings #-}
module Main where

import Data.Aeson (encode, decode)
import QuickType
import Data.Maybe (fromJust)
import System.Environment
import qualified Data.ByteString.Lazy as BS

main :: IO ()
main = do
    args <- getArgs
    let filePath = head args
    content <- BS.readFile filePath
    let dec = decodeTopLevel content
    BS.putStr $ encode dec
