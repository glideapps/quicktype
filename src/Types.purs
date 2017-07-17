module Types where

import Prelude

import Data.List as L

import IR
import Doc

type Renderer = {
    name :: String,
    aceMode :: String,
    render :: L.List IRClassData -> Doc Unit
}