module Test.Main where

import Prelude

import Data.Foldable (for_)
import Data.String.Util as StrUtil
import Test.Unit (suite, test)
import Test.Unit.Assert as Assert
import Test.Unit.Main (runTest)

main = runTest do
  test_Data_String_Util
    
test_Data_String_Util = suite "Data.String.Util" do
    test "isInt" do
      for_ shouldBeInt \i ->
        Assert.assert (i <> " should be int") $ StrUtil.isInt i
      for_ shouldNotBeInt \i ->
        Assert.assertFalse (i <> " should not be int") $ StrUtil.isInt i
    where
      shouldBeInt = ["10"]
      shouldNotBeInt = ["10.0"]