module Types where

import Prelude

import Data.List as L

import IRGraph
import Doc

type Renderer = {
    name :: String,
    extension :: String,
    aceMode :: String,
    render :: IRGraph -> String
}