port module Main exposing (..)

-- this is required for the ports
import Json.Decode exposing (decodeString)
import QuickType

port fromJS : (String -> msg) -> Sub msg
port toJS : String -> Cmd msg

type Msg
    = FromJS String

update : Msg -> () -> ( (), Cmd Msg )
update msg _ =
    case msg of
        FromJS str ->
            case decodeString QuickType.quickType str of
            Ok r -> ((), toJS (QuickType.encodeQuickType r))
            Err err -> ((), toJS ("Error: " ++ err))

subscriptions : () -> Sub Msg
subscriptions _ =
    fromJS (FromJS)

main : Program Never () Msg
main =
    Platform.program
        { init = ( (), Cmd.none )
        , update = update
        , subscriptions = subscriptions
        }
